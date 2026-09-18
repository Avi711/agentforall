module "worker" {
  source   = "./modules/worker"
  for_each = var.workers

  name                      = each.key
  ip                        = each.value.ip
  machine_type              = each.value.machine_type
  data_disk_gb              = each.value.data_disk_gb
  boot_disk_gb              = var.worker_boot_disk_gb
  image                     = var.worker_image
  zone                      = var.zone
  region                    = var.region
  subnetwork                = google_compute_subnetwork.default.id
  service_account_email     = google_service_account.worker.email
  snapshot_policy           = google_compute_resource_policy.daily_snapshot.name
  ssh_keys                  = "${var.ssh_user}:${file(var.ssh_public_key_path)}"
  startup_dir               = "${path.module}/startup"
  startup_vars              = local.startup_vars
  tenant_bridge             = local.tenant_bridge
  orchestrator_internal_url = local.orchestrator_internal_url
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
