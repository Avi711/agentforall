import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { DomainError } from "../domain/errors.js";
import { ZodError } from "zod";

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof DomainError) {
    void reply.status(error.statusCode).send(error.toJSON());
    return;
  }

  if (error instanceof ZodError) {
    void reply.status(400).send({
      code: "VALIDATION_ERROR",
      message: "request validation failed",
      details: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    void reply.status(error.statusCode).send({
      code: error.code ?? "ERROR",
      message: error.message,
    });
    return;
  }

  request.log.error({ err: error }, "unhandled error");
  void reply.status(500).send({
    code: "INTERNAL_ERROR",
    message: "internal server error",
  });
}
