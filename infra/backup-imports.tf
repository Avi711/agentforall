resource "google_storage_bucket" "backup_imports" {
  name                        = "agent-forall-backup-imports"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  cors {
    origin          = ["https://agentforall.co.il"]
    method          = ["PUT"]
    response_header = ["Content-Type", "Content-Range", "Range", "X-Upload-Content-Type", "X-Upload-Content-Length", "x-goog-resumable"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 1
    }
  }

  labels = {
    app = "agent-forall"
  }
}

resource "google_storage_bucket_iam_member" "backup_imports_vm_object_admin" {
  bucket = google_storage_bucket.backup_imports.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.platform.email}"
}
