# The control plane's own VM, never a bot. No snapshots: everything renders at boot, and Caddy re-issues its one certificate.

# The public address of api.<domain>. `platform` is the historical name, kept so the live address and identity never move in state.
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

resource "google_compute_address" "orchestrator_internal" {
  name         = "orchestrator-internal"
  region       = var.region
  address_type = "INTERNAL"
  subnetwork   = google_compute_subnetwork.default.id
  address      = var.orchestrator_vm_internal_ip
}

resource "google_compute_disk" "orchestrator_data" {
  name = "orchestrator-data"
  zone = var.zone
  type = "pd-balanced"
  size = 10

  labels = {
    app = "agent-forall"
  }
}

locals {
  control_plane_startup = join("", [
    templatefile("${path.module}/startup/common.sh", merge(local.startup_vars, {
      data_disk_name = google_compute_disk.orchestrator_data.name
      daemon_json    = jsonencode({ "data-root" = "/mnt/docker", "firewall-backend" = "iptables" })
      guard_rules = templatefile("${path.module}/startup/guard-orchestrator.rules", {
        frontend_bridge          = local.frontend_bridge
        orchestrator_frontend_ip = local.orchestrator_frontend_ip
      })
    })),
    templatefile("${path.module}/startup/control-plane.sh", merge(local.startup_vars, {
      domain                   = var.domain
      orchestrator_image       = var.orchestrator_image
      caddy_image              = var.caddy_image
      docker_proxy_image       = var.docker_proxy_image
      litellm_gateway_url      = google_cloud_run_v2_service.litellm.uri
      frontend_bridge          = local.frontend_bridge
      frontend_subnet          = local.frontend_subnet
      orchestrator_frontend_ip = local.orchestrator_frontend_ip
      vpc_cidr                 = var.vpc_cidr
      port_range_start         = local.port_range_start
      port_range_end           = local.port_range_end
      sidecar_port_range_start = local.sidecar_port_range_start
      move_source_retention_ms = var.move_source_retention_ms
      worker_instance_ids      = join(",", [for name, worker in module.worker : "${name}=${worker.instance_id}"])
      worker_addresses         = join(",", [for name, worker in module.worker : "${name}=${worker.address}"])
    })),
  ])
}

resource "google_compute_instance" "orchestrator" {
  name         = "orchestrator"
  machine_type = var.orchestrator_vm_machine_type
  zone         = var.zone
  tags         = ["agent-forall", "orchestrator"]

  boot_disk {
    initialize_params {
      image = "projects/ubuntu-os-cloud/global/images/family/ubuntu-2404-lts-amd64"
      size  = 20
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.orchestrator_data.self_link
    device_name = google_compute_disk.orchestrator_data.name
    mode        = "READ_WRITE"
  }

  network_interface {
    subnetwork = google_compute_subnetwork.default.id
    network_ip = google_compute_address.orchestrator_internal.address

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
    startup-script         = local.control_plane_startup
  }

  labels = {
    app  = "agent-forall"
    role = "orchestrator"
  }

  allow_stopping_for_update = false
  deletion_protection       = true

  # A new Ubuntu family image must never replace the control plane on an unrelated apply.
  lifecycle {
    ignore_changes = [boot_disk[0].initialize_params[0].image]
  }
}
