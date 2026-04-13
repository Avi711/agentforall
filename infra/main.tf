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

  boot_disk {
    initialize_params {
      image = "projects/cos-cloud/global/images/family/cos-stable"
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
    scopes = ["logging-write", "monitoring-write"]
  }

  metadata = {
    ssh-keys               = "${var.ssh_user}:${file(var.ssh_public_key_path)}"
    google-logging-enabled = "true"
    cos-metrics-enabled    = "true"
  }

  metadata_startup_script = templatefile("${path.module}/startup.sh", {
    domain = var.domain
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
