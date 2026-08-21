resource "google_project_service" "cloud_run" {
  project            = var.project_id
  service            = "run.googleapis.com"
  disable_on_destroy = false
}

resource "google_service_account" "litellm" {
  account_id   = "agent-forall-litellm"
  display_name = "agent-forall LiteLLM gateway"
}

resource "google_project_iam_member" "litellm_logging" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.litellm.email}"
}

resource "google_project_iam_member" "litellm_monitoring" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.litellm.email}"
}

resource "google_artifact_registry_repository_iam_member" "litellm_pull" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.litellm.email}"
}

locals {
  litellm_secret_ids = [
    "litellm-master-key",
    "litellm-salt-key",
    "gemini-api-key",
  ]
}

data "google_secret_manager_secret" "litellm_secrets" {
  for_each  = toset(local.litellm_secret_ids)
  secret_id = each.key
}

resource "google_secret_manager_secret_iam_member" "litellm_secret_access" {
  for_each  = data.google_secret_manager_secret.litellm_secrets
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.litellm.email}"
}

resource "google_cloud_run_v2_service" "litellm" {
  name     = "litellm-gateway"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.litellm.email

    scaling {
      min_instance_count = var.litellm_min_instances
      max_instance_count = var.litellm_max_instances
    }

    vpc_access {
      egress = "PRIVATE_RANGES_ONLY"

      network_interfaces {
        network = data.google_compute_network.default.name
      }
    }

    containers {
      image = var.litellm_image

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = var.litellm_cpu
          memory = var.litellm_memory
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.litellm_cloudsql_database_url.secret_id
            version = google_secret_manager_secret_version.litellm_cloudsql_database_url.version
          }
        }
      }

      env {
        name = "LITELLM_MASTER_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.litellm_secrets["litellm-master-key"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "LITELLM_SALT_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.litellm_secrets["litellm-salt-key"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.litellm_secrets["gemini-api-key"].secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "LITELLM_MODE"
        value = "PRODUCTION"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.litellm.connection_name]
      }
    }
  }

  depends_on = [
    google_project_service.cloud_run,
    google_artifact_registry_repository_iam_member.litellm_pull,
    google_secret_manager_secret_iam_member.litellm_secret_access,
    google_secret_manager_secret_iam_member.litellm_cloudsql_database_url_access,
    google_project_iam_member.litellm_cloudsql_client,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "litellm_internal_invoker" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.litellm.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
