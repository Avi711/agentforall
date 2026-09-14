-- One-way: the previous schema required these keys, so no orchestrator rollback past this.
UPDATE "instances" SET "config" = "config" #- '{integrations,relayUrl}' WHERE "config" #> '{integrations,relayUrl}' IS NOT NULL;--> statement-breakpoint
UPDATE "instances" SET "config" = jsonb_set("config", '{channels}', (SELECT jsonb_agg(elem - 'relayUrl' ORDER BY i) FROM jsonb_array_elements("config"->'channels') WITH ORDINALITY AS c(elem, i))) WHERE "config"->'channels' @> '[{"type":"whatsapp_cloud"}]';
