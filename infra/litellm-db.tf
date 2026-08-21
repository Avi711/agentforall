resource "google_project_service" "sqladmin" {
  project            = var.project_id
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "servicenetworking" {
  project            = var.project_id
  service            = "servicenetworking.googleapis.com"
  disable_on_destroy = false
}

data "google_compute_network" "default" {
  name = "default"
}

resource "google_compute_global_address" "private_services" {
  name          = "agent-forall-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = data.google_compute_network.default.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]

  depends_on = [google_project_service.servicenetworking]
}

resource "random_password" "litellm_db" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "litellm" {
  name                = "agent-forall-litellm"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.litellm_db_deletion_protection

  settings {
    tier              = var.litellm_db_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = var.litellm_db_disk_size_gb
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "02:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.default.id
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
      record_client_address   = true
    }
  }

  depends_on = [
    google_project_service.sqladmin,
    google_service_networking_connection.private_services,
  ]
}

resource "google_sql_database" "litellm" {
  name     = "litellm"
  instance = google_sql_database_instance.litellm.name
}

resource "google_sql_user" "litellm" {
  name     = "litellm"
  instance = google_sql_database_instance.litellm.name
  password = random_password.litellm_db.result
}

resource "google_secret_manager_secret" "litellm_cloudsql_database_url" {
  secret_id = "litellm-cloudsql-database-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "litellm_cloudsql_database_url" {
  secret = google_secret_manager_secret.litellm_cloudsql_database_url.id
  secret_data = format(
    "postgresql://%s:%s@localhost/%s?host=/cloudsql/%s",
    google_sql_user.litellm.name,
    random_password.litellm_db.result,
    google_sql_database.litellm.name,
    google_sql_database_instance.litellm.connection_name,
  )
}

resource "google_secret_manager_secret_iam_member" "litellm_cloudsql_database_url_access" {
  secret_id = google_secret_manager_secret.litellm_cloudsql_database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.litellm.email}"
}

resource "google_project_iam_member" "litellm_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.litellm.email}"
}
