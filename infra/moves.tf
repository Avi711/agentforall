# Bot moves: the whole state volume (WhatsApp session included) rests here for minutes under our own key; the lifecycle reaps abandoned moves.

resource "google_project_service" "cloudkms" {
  service            = "cloudkms.googleapis.com"
  disable_on_destroy = false
}

data "google_storage_project_service_account" "gcs" {}

resource "google_kms_key_ring" "moves" {
  name     = "agent-forall-moves"
  location = var.region

  depends_on = [google_project_service.cloudkms]
}

resource "google_kms_crypto_key" "moves" {
  name            = "moves-bucket"
  key_ring        = google_kms_key_ring.moves.id
  rotation_period = "7776000s"

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "moves_gcs_agent" {
  crypto_key_id = google_kms_crypto_key.moves.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

resource "google_storage_bucket" "moves" {
  name                        = "agent-forall-moves"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  encryption {
    default_kms_key_name = google_kms_crypto_key.moves.id
  }

  # Two days, not one: a day-boundary rule can fire mid-move.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age            = 2
      matches_prefix = ["moves/"]
    }
  }

  # The volume as it was before a rebuild onto another image: the rollback of an irreversible migration.
  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age            = 14
      matches_prefix = ["snapshots/"]
    }
  }

  labels = {
    app = "agent-forall"
  }

  depends_on = [google_kms_crypto_key_iam_member.moves_gcs_agent]
}

resource "google_storage_bucket_iam_member" "moves_vm_object_user" {
  bucket = google_storage_bucket.moves.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.platform.email}"
}
