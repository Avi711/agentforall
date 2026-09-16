# Orchestrator → worker Docker over mTLS. Certificates are issued offline by infra/ops/issue-control-plane-cert.sh into
# Secret Manager; the CA key is never referenced here and never reaches a VM.
resource "google_service_account" "worker" {
  account_id   = "agent-forall-worker"
  display_name = "agent-forall worker VM"
}

resource "google_project_iam_member" "worker_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_artifact_registry_repository_iam_member" "worker_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.worker.email}"
}

data "google_secret_manager_secret" "control_plane" {
  for_each  = toset(["control-plane-ca-cert", "orchestrator-client-cert", "orchestrator-client-key"])
  secret_id = each.key
}

resource "google_secret_manager_secret_iam_member" "orchestrator_control_plane" {
  for_each  = data.google_secret_manager_secret.control_plane
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.platform.email}"
}

# Workers verify the orchestrator's client cert and hand bots the tenant CA root (cert only).
resource "google_secret_manager_secret_iam_member" "worker_shared_secrets" {
  for_each = {
    control-plane-ca-cert  = data.google_secret_manager_secret.control_plane["control-plane-ca-cert"].id
    caddy-internal-ca-cert = data.google_secret_manager_secret.vm_secrets["caddy-internal-ca-cert"].id
  }
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}
