resource "google_compute_address" "platform" {
  name   = "agent-forall-ip"
  region = var.region
}

# The VM's existing internal IP, promoted to static so the private DNS record and worker firewalls stay true.
resource "google_compute_address" "platform_internal" {
  name         = "agent-forall-internal"
  region       = var.region
  address_type = "INTERNAL"
  subnetwork   = google_compute_subnetwork.default.id
  address      = var.orchestrator_internal_ip
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

locals {
  orchestrator_startup = join("", [
    templatefile("${path.module}/startup/common.sh", merge(local.startup_vars, {
      data_disk_name = google_compute_disk.data.name
      daemon_json    = jsonencode({ "data-root" = "/mnt/docker", "firewall-backend" = "iptables" })
      guard_rules = templatefile("${path.module}/startup/guard-orchestrator.rules", {
        frontend_bridge          = local.frontend_bridge
        orchestrator_frontend_ip = local.orchestrator_frontend_ip
      })
    })),
    templatefile("${path.module}/startup/orchestrator.sh", merge(local.startup_vars, {
      domain                   = var.domain
      orchestrator_image       = var.orchestrator_image
      litellm_gateway_url      = google_cloud_run_v2_service.litellm.uri
      frontend_bridge          = local.frontend_bridge
      frontend_subnet          = local.frontend_subnet
      orchestrator_frontend_ip = local.orchestrator_frontend_ip
      vpc_cidr                 = var.vpc_cidr
      port_range_start         = local.port_range_start
      port_range_end           = local.port_range_end
      sidecar_port_range_start = local.sidecar_port_range_start
      move_source_retention_ms = var.move_source_retention_ms
      stack_enabled            = var.control_plane_vm == "platform"
      worker_instance_ids      = join(",", [for name, worker in module.worker : "${name}=${worker.instance_id}"])
      worker_addresses         = join(",", [for name, worker in module.worker : "${name}=${worker.address}"])
    })),
  ])
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
  tags         = ["agent-forall", "orchestrator"]

  # Ubuntu rather than Container-Optimized OS: the startup script installs Docker, cron and the ops agent itself.
  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  # Docker data-root (/mnt/docker): every tenant volume lives here, so it outlives the instance.
  attached_disk {
    source      = google_compute_disk.data.self_link
    device_name = google_compute_disk.data.name
    mode        = "READ_WRITE"
  }

  network_interface {
    network    = "default"
    network_ip = google_compute_address.platform_internal.address

    # Follows control_plane_vm. Terraform cannot order the swap: `delete-access-config` on the other VM first.
    dynamic "access_config" {
      for_each = var.control_plane_vm == "platform" ? [1] : []
      content {
        nat_ip = google_compute_address.platform.address
      }
    }
  }

  service_account {
    email  = google_service_account.platform.email
    scopes = ["cloud-platform"]
  }

  # startup-script as a plain metadata key updates in place; metadata_startup_script would replace the VM.
  metadata = {
    ssh-keys               = "${var.ssh_user}:${file(var.ssh_public_key_path)}"
    google-logging-enabled = "true"
    startup-script         = local.orchestrator_startup
  }

  labels = {
    app  = "agent-forall"
    role = "orchestrator"
  }

  # A change the provider can only apply through a stop must fail the plan, never stop prod on its own.
  allow_stopping_for_update = false

  # Tenant volumes sit on the data disk, but a replace still means a full outage and a first-boot bootstrap.
  deletion_protection = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_disk_resource_policy_attachment" "snapshot" {
  name = google_compute_resource_policy.daily_snapshot.name
  disk = google_compute_instance.platform.name
  zone = var.zone
}

resource "google_compute_disk" "data" {
  name = "agent-forall-data"
  zone = var.zone
  type = "pd-balanced"
  size = 80

  labels = {
    app = "agent-forall"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_disk_resource_policy_attachment" "data_snapshot" {
  name = google_compute_resource_policy.daily_snapshot.name
  disk = google_compute_disk.data.name
  zone = var.zone
}
