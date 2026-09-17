# Secrets are created by the operator (`gcloud secrets create`); Terraform owns only the IAM bindings, never the values.
locals {
  vm_secret_ids = [
    "database-url",
    "encryption-key",
    "dashboard-service-token",
    "default-provider-api-key",
    "litellm-master-key",
    "composio-api-key",
    "telegram-manager-bot-token",
    "caddy-internal-ca-cert",
    "caddy-internal-ca-key",
  ]
}

data "google_secret_manager_secret" "vm_secrets" {
  for_each  = toset(local.vm_secret_ids)
  secret_id = each.key
}

resource "google_secret_manager_secret_iam_member" "vm_secret_access" {
  for_each  = data.google_secret_manager_secret.vm_secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.platform.email}"
}
