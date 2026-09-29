const STATEMENT_DESCRIPTOR = "PADDLE.NET* AGENT4ALL";

export function StatementLine() {
  return (
    <span>
      בפירוט האשראי יופיע:{" "}
      <bdi dir="ltr" className="whitespace-nowrap font-medium text-espresso">
        {STATEMENT_DESCRIPTOR}
      </bdi>
    </span>
  );
}
