terraform {
  required_providers {
    google = {
      source = "hashicorp/google"
    }
  }
}

data "google_compute_image" "worker" {
  name = var.image
}

# Reserved before the VM exists: the server certificate carries this address as its SAN.
resource "google_compute_address" "internal" {
  name         = "${var.name}-internal"
  region       = var.region
  address_type = "INTERNAL"
  subnetwork   = var.subnetwork
  address      = var.ip
}

# Bot volumes live here: removing a worker is `terraform state rm` on this disk first, then the entry, then the disk by hand.
resource "google_compute_disk" "data" {
  name = "${var.name}-data"
  zone = var.zone
  type = "pd-balanced"
  size = var.data_disk_gb

  labels = {
    app = "agent-forall"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_disk_resource_policy_attachment" "data_snapshot" {
  name = var.snapshot_policy
  disk = google_compute_disk.data.name
  zone = var.zone
}

resource "google_compute_instance" "worker" {
  name         = var.name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = ["worker"]

  boot_disk {
    initialize_params {
      image = data.google_compute_image.worker.self_link
      size  = var.boot_disk_gb
      type  = "pd-balanced"
    }
  }

  attached_disk {
    source      = google_compute_disk.data.self_link
    device_name = google_compute_disk.data.name
    mode        = "READ_WRITE"
  }

  # No public address: egress through Cloud NAT, ingress from the orchestrator's tag only.
  network_interface {
    subnetwork = var.subnetwork
    network_ip = google_compute_address.internal.address
  }

  service_account {
    email  = var.service_account_email
    scopes = ["cloud-platform"]
  }

  metadata = {
    ssh-keys               = var.ssh_keys
    google-logging-enabled = "true"
    startup-script = join("", [
      templatefile("${var.startup_dir}/common.sh", merge(var.startup_vars, {
        data_disk_name = google_compute_disk.data.name
        daemon_json = jsonencode({
          "data-root"        = "/mnt/docker"
          "firewall-backend" = "iptables"
          "hosts"            = ["fd://", "tcp://${var.ip}:2376"]
          "tlsverify"        = true
          "tlscacert"        = "/var/lib/agent-forall/control-plane/ca.crt"
          "tlscert"          = "/var/lib/agent-forall/control-plane/server.crt"
          "tlskey"           = "/var/lib/agent-forall/control-plane/server.key"
          "live-restore"     = true
        })
        guard_rules = templatefile("${var.startup_dir}/guard-worker.rules", { tenant_bridge = var.tenant_bridge })
      })),
      templatefile("${var.startup_dir}/worker.sh", merge(var.startup_vars, {
        host_id                   = var.name
        tenant_bridge             = var.tenant_bridge
        orchestrator_internal_url = var.orchestrator_internal_url
      })),
    ])
  }

  labels = {
    app  = "agent-forall"
    role = "worker"
  }

  # A change that needs a stop (machine type) must be a deliberate, announced action: bots stop with the VM.
  allow_stopping_for_update = false
}

# The worker reads its own server certificate and nothing else that is per host.
data "google_secret_manager_secret" "tls" {
  for_each  = toset(["${var.name}-server-cert", "${var.name}-server-key"])
  secret_id = each.key
}

resource "google_secret_manager_secret_iam_member" "tls" {
  for_each  = data.google_secret_manager_secret.tls
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account_email}"
}
