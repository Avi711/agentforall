import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { FeatureUnavailableError } from "../domain/errors.js";
import {
  CATALOG_MAX_LIMIT,
  CATALOG_MAX_OFFSET,
  CATALOG_MAX_SLUGS,
  INTEGRATION_APP_SLUG_PATTERN,
  INTEGRATION_REF_PATTERN,
} from "../domain/integrations.js";
import type { IntegrationsManager } from "../services/integrations/manager.js";

const InstanceParam = z.object({ id: z.string().uuid() });
const ConnectParams = InstanceParam.extend({ app: z.string().regex(INTEGRATION_APP_SLUG_PATTERN) });
const ConnectionParams = InstanceParam.extend({ ref: z.string().regex(INTEGRATION_REF_PATTERN) });
const ConnectBody = z.object({ returnUrl: z.string().url() }).strict();
const CatalogQuery = z
  .object({
    q: z.string().max(64).optional(),
    slugs: z
      .string()
      .transform((value) => value.split(",").filter((slug) => slug !== ""))
      .pipe(z.array(z.string().regex(INTEGRATION_APP_SLUG_PATTERN)).max(CATALOG_MAX_SLUGS))
      .optional(),
    limit: z.coerce.number().int().min(1).max(CATALOG_MAX_LIMIT).default(24),
    offset: z.coerce.number().int().min(0).max(CATALOG_MAX_OFFSET).default(0),
  })
  .strict();

export interface IntegrationsRouteDeps {
  integrations: IntegrationsManager | null;
}

export const integrationsRoutes: FastifyPluginAsync<IntegrationsRouteDeps> = async (app, deps) => {
  const requireIntegrations = (): IntegrationsManager => {
    if (!deps.integrations) throw new FeatureUnavailableError("integrations");
    return deps.integrations;
  };

  app.get("/integrations/catalog", async (request, reply) => {
    const query = CatalogQuery.parse(request.query);
    const page = await requireIntegrations().catalog(query);
    return reply.send({ data: page.apps, total: page.total });
  });

  app.get("/instances/:id/integrations", async (request, reply) => {
    const { id } = InstanceParam.parse(request.params);
    const data = await requireIntegrations().list(id, request.authenticatedUserId);
    return reply.send({ data });
  });

  app.post("/instances/:id/integrations/:app/connect", async (request, reply) => {
    const { id, app: slug } = ConnectParams.parse(request.params);
    const { returnUrl } = ConnectBody.parse(request.body);
    const link = await requireIntegrations().connect(id, request.authenticatedUserId, slug, returnUrl);
    return reply.status(201).send(link);
  });

  app.delete("/instances/:id/integrations/:ref", async (request, reply) => {
    const { id, ref } = ConnectionParams.parse(request.params);
    await requireIntegrations().disconnect(id, request.authenticatedUserId, ref);
    return reply.status(204).send();
  });
};
