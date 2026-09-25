import { z } from "zod";
import { PLAN_CATALOGUE, PLAN_TIERS, YEARLY_DISCOUNT_PERCENT, agorotFromIls, type Plan, type PlanTier } from "../src/lib/billing/pricing";
import { paddleRequest, type PaddleConnection } from "../src/lib/billing/providers/paddle/client";
import { readPaddleConnection } from "../src/lib/billing/providers/paddle/config";
import { PRICE_PLAN_KEY, SINGLE_UNIT } from "../src/lib/billing/providers/paddle/wire";

const PRODUCT_KEY = "agentforall_product";
const TOPUP = "topup";

// Paddle's checkout and invoices have no Hebrew, so everything the buyer reads there is English.
const TIER_NAMES: Record<PlanTier, string> = { basic: "Basic", standard: "Standard", pro: "Pro" };
const TOPUP_PRODUCT_NAME = "Agent For All Credits";

const PriceSchema = z.object({
  id: z.string(),
  status: z.string(),
  name: z.string().nullable(),
  custom_data: z.record(z.string(), z.unknown()).nullable(),
  unit_price: z.object({ amount: z.string(), currency_code: z.string() }),
  billing_cycle: z.object({ interval: z.string(), frequency: z.number() }).nullable(),
  tax_mode: z.string(),
  quantity: z.object({ minimum: z.number(), maximum: z.number() }),
});
type Price = z.infer<typeof PriceSchema>;
const ProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  custom_data: z.record(z.string(), z.unknown()).nullable(),
  prices: z.array(PriceSchema).optional(),
});
type Product = z.infer<typeof ProductSchema>;

function priceName(plan: Plan): string {
  return plan.interval === "year" ? `Yearly (${YEARLY_DISCOUNT_PERCENT}% off)` : "Monthly";
}

// Names are safe to change under live subscribers; amounts are not (see `matches`).
async function ensureProduct(conn: PaddleConnection, products: Product[], key: string, name: string): Promise<Product> {
  const existing = products.find((product) => product.custom_data?.[PRODUCT_KEY] === key);
  if (!existing) {
    console.log(`creating product ${key}`);
    return paddleRequest(conn, "POST", "/products", ProductSchema, {
      idempotent: false,
      body: { name, tax_category: "saas", custom_data: { [PRODUCT_KEY]: key } },
    });
  }
  if (existing.name === name) return existing;
  console.log(`renaming product ${key}`);
  await paddleRequest(conn, "PATCH", `/products/${existing.id}`, ProductSchema, { idempotent: true, body: { name } });
  return existing;
}

async function ensurePriceName(conn: PaddleConnection, price: Price, plan: Plan): Promise<void> {
  const name = priceName(plan);
  if (price.name === name) return;
  console.log(`renaming price ${plan.code}`);
  await paddleRequest(conn, "PATCH", `/prices/${price.id}`, PriceSchema, { idempotent: true, body: { name, description: plan.code } });
}

async function main(): Promise<void> {
  const conn: PaddleConnection = readPaddleConnection(process.env);
  const products = await paddleRequest(conn, "GET", "/products?status=active&include=prices&per_page=200", z.array(ProductSchema), {
    idempotent: true,
  });

  const priceIds: Record<string, string> = {};
  const problems: string[] = [];
  for (const tier of PLAN_TIERS) {
    const product = await ensureProduct(conn, products, tier, `Agent For All ${TIER_NAMES[tier]}`);
    for (const plan of PLAN_CATALOGUE.filter((candidate) => candidate.tier === tier)) {
      const amount = String(agorotFromIls(plan.priceIls));
      const existing = product.prices?.find((price) => price.status === "active" && price.custom_data?.[PRICE_PLAN_KEY] === plan.code);
      if (existing) {
        const matches =
          existing.unit_price.amount === amount &&
          existing.unit_price.currency_code === "ILS" &&
          existing.billing_cycle?.interval === plan.interval &&
          existing.billing_cycle.frequency === 1 &&
          existing.tax_mode === "internal" &&
          existing.quantity.minimum === SINGLE_UNIT.minimum &&
          existing.quantity.maximum === SINGLE_UNIT.maximum;
        if (!matches) problems.push(`${plan.code}: ${existing.id} differs from pricing.ts; archive it in Paddle and rerun (subscribers keep it)`);
        await ensurePriceName(conn, existing, plan);
        priceIds[plan.code] = existing.id;
        continue;
      }
      console.log(`creating price ${plan.code}`);
      const created = await paddleRequest(conn, "POST", "/prices", PriceSchema, {
        idempotent: false,
        body: {
          product_id: product.id,
          description: plan.code,
          name: priceName(plan),
          unit_price: { amount, currency_code: "ILS" },
          billing_cycle: { interval: plan.interval, frequency: 1 },
          tax_mode: "internal",
          quantity: SINGLE_UNIT,
          custom_data: { [PRICE_PLAN_KEY]: plan.code },
        },
      });
      priceIds[plan.code] = created.id;
    }
  }
  const topup = await ensureProduct(conn, products, TOPUP, TOPUP_PRODUCT_NAME);

  for (const problem of problems) console.error(`MISMATCH ${problem}`);
  console.log(`\nPADDLE_PRICE_IDS=${JSON.stringify(priceIds)}`);
  console.log(`PADDLE_TOPUP_PRODUCT_ID=${topup.id}`);
  if (problems.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
