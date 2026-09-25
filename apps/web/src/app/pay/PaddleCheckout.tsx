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
      // An already-paid or cancelled transaction never opens.
      if (event.name === CheckoutEventNames.CHECKOUT_ERROR && active) setFailed(true);
      // Closing the overlay is not a failure: the user goes back to settings and can try again.
      if (event.name === CheckoutEventNames.CHECKOUT_CLOSED && !completed) window.location.assign(exitPath);
    };
    initializePaddle({
      environment,
      token: clientToken,
      eventCallback: onEvent,
      checkout: {
        settings: {
          displayMode: "overlay",
          // Email, country and card on one screen instead of two steps.
          variant: "one-page",
          successUrl: new URL(successPath, window.location.origin).toString(),
          // The email is the Paddle customer. A discount, or a tax number on our VAT-inclusive price, can lower the total below the amount check.
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
