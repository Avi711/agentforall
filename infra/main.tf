terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "agent-forall-tf-state"
    prefix = "infra"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}

resource "google_compute_address" "platform" {
  name   = "agent-forall-ip"
  region = var.region
}

resource "google_service_account" "platform" {
  account_id   = "agent-forall"
  display_name = "agent-forall platform"
}

resource "google_project_iam_member" "logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.platform.email}"
}

resource "google_project_iam_member" "monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.platform.email}"
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "agent-forall"
  description   = "Container images for the agent-forall platform"
  format        = "DOCKER"
}

resource "google_artifact_registry_repository_iam_member" "vm_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.platform.email}"
}

# ── GitHub Actions image push via Workload Identity Federation (no JSON keys) ──
resource "google_service_account" "ci_pusher" {
  account_id   = "agent-forall-ci"
  display_name = "agent-forall CI image pusher"
}

resource "google_artifact_registry_repository_iam_member" "ci_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.ci_pusher.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github-actions"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"
  attribute_condition                = "assertion.repository == \"${var.github_repo}\""
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "ci_pusher_wif_bind" {
  service_account_id = google_service_account.ci_pusher.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

# ── Secret Manager — survives VM recreation; populated out-of-band by operator ──
locals {
  vm_secrets = {
    "database-url"             = "Supabase / Cloud SQL DATABASE_URL connection string"
    "encryption-key"           = "AES-256-GCM key (32 bytes hex) — encrypts tenant tokens + WhatsApp creds in DB"
    "dashboard-service-token"  = "Bearer token shared with Vercel to call orchestrator on user's behalf"
    "default-provider-api-key" = "LLM provider API key (Anthropic/OpenAI/Gemini/OpenRouter) injected into every new tenant bot"
  }
}

resource "google_secret_manager_secret" "vm_secrets" {
  for_each  = local.vm_secrets
  secret_id = each.key
  labels    = { app = "agent-forall" }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "vm_secret_access" {
  for_each  = google_secret_manager_secret.vm_secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.platform.email}"
}

resource "google_compute_firewall" "allow_http" {
  name    = "agent-forall-allow-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["agent-forall"]
}

resource "google_compute_firewall" "allow_ssh_iap" {
  name    = "agent-forall-allow-ssh-iap"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["agent-forall"]
}

resource "google_compute_resource_policy" "daily_snapshot" {
  name   = "agent-forall-daily-snapshot"
  region = var.region

  snapshot_schedule_policy {
    schedule {
      daily_schedule {
        days_in_cycle = 1
        start_time    = "03:00"
      }
    }

    retention_policy {
      max_retention_days = 14
    }
  }
}

resource "google_compute_instance" "platform" {
  name         = "agent-forall"
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["agent-forall"]

  # Ubuntu 24.04 LTS — chosen over Container-Optimized OS because the platform
  # installs its own Docker + cron + compose via startup.sh and benefits from
  # writable /usr/local (needed for gVisor and docker-compose plugin installs).
  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = var.disk_size_gb
      type  = "pd-ssd"
    }
  }

  network_interface {
    network = "default"

    access_config {
      nat_ip = google_compute_address.platform.address
    }
  }

  service_account {
    email  = google_service_account.platform.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    ssh-keys               = "${var.ssh_user}:${file(var.ssh_public_key_path)}"
    google-logging-enabled = "true"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh", {
    domain     = var.domain
    region     = var.region
    project_id = var.project_id
  })

  labels = {
    app = "agent-forall"
  }

  allow_stopping_for_update = true
}

resource "google_compute_disk_resource_policy_attachment" "snapshot" {
  name = google_compute_resource_policy.daily_snapshot.name
  disk = google_compute_instance.platform.name
  zone = var.zone
}
