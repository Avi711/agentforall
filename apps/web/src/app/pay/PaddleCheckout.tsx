"use client";

import { CheckoutEventNames, initializePaddle, type PaddleEventData } from "@paddle/paddle-js";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PaddleEnvironment } from "@/lib/billing/providers/paddle/config";
import { Spinner } from "../app/Marks";

export function PaddleCheckout({
  environment,
  clientToken,
  transactionId,
  email,
  successPath,
  exitPath,
}: {
  environment: PaddleEnvironment;
  clientToken: string;
  // Null when Paddle.js opens the transaction from the page URL itself.
  transactionId: string | null;
  email: string | null;
  successPath: string;
  exitPath: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let completed = false;
    const onEvent = (event: PaddleEventData) => {
      if (event.name === CheckoutEventNames.CHECKOUT_COMPLETED) completed = true;
      if (event.name === CheckoutEventNames.CHECKOUT_ERROR && active) setFailed(true);
      if (event.name === CheckoutEventNames.CHECKOUT_CLOSED && !completed) window.location.assign(exitPath);
    };
    initializePaddle({
      environment,
      token: clientToken,
      eventCallback: onEvent,
      checkout: {
        settings: {
          displayMode: "overlay",
          variant: "one-page",
          successUrl: new URL(successPath, window.location.origin).toString(),
          // A discount or a tax number can lower the total below the amount check.
          allowLogout: false,
          showAddDiscounts: false,
          showAddTaxId: false,
        },
      },
    }).then(
      (paddle) => {
        if (!active) return;
        if (!paddle) return setFailed(true);
        if (transactionId) paddle.Checkout.open({ transactionId, customer: email ? { email } : undefined });
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [environment, clientToken, transactionId, email, successPath, exitPath]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 px-4 text-center">
      {failed ? (
        <>
          <p className="text-espresso">לא הצלחנו לפתוח את עמוד התשלום. נסו שוב מההגדרות.</p>
          <Link href={exitPath} className="text-sm text-terra underline">
            חזרה להגדרות
          </Link>
        </>
      ) : (
        <p className="flex items-center gap-2 text-espresso-light">
          <Spinner />
          פותחים את עמוד התשלום…
        </p>
      )}
    </div>
  );
}
