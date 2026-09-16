# The project's default VPC, switched to custom subnet mode and imported; only the europe-west4 subnet is managed.
resource "google_compute_network" "default" {
  name                    = "default"
  description             = "Default network for the project"
  auto_create_subnetworks = false

  lifecycle {
    prevent_destroy = true
  }
}

# Private Google Access: GAR, Secret Manager and GCS without spending NAT ports.
resource "google_compute_subnetwork" "default" {
  name                     = "default"
  region                   = var.region
  network                  = google_compute_network.default.id
  ip_cidr_range            = var.vpc_cidr
  private_ip_google_access = true

  lifecycle {
    prevent_destroy = true
  }
}

# Same priority as GCP's default-allow-* rules, and a tie goes to deny: recreating one of them changes nothing.
resource "google_compute_firewall" "deny_all_ingress" {
  name     = "agent-forall-deny-all-ingress"
  network  = google_compute_network.default.name
  priority = 65534

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
}

resource "google_compute_firewall" "allow_http" {
  name    = "agent-forall-allow-http"
  network = google_compute_network.default.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["agent-forall"]
}

resource "google_compute_firewall" "allow_ssh_iap" {
  name    = "agent-forall-allow-ssh-iap"
  network = google_compute_network.default.name

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["agent-forall", "worker"]
}

# Docker over mTLS, the bots' gateway ports and the pairing sidecar range: the orchestrator is the only caller.
resource "google_compute_firewall" "worker_from_orchestrator" {
  name    = "agent-forall-worker-from-orchestrator"
  network = google_compute_network.default.name

  allow {
    protocol = "tcp"
    ports = [
      "2376",
      "${local.sidecar_port_range_start}-${local.sidecar_port_range_start + local.port_range_end - local.port_range_start}",
      "${local.port_range_start}-${local.port_range_end}",
    ]
  }

  source_tags = ["orchestrator"]
  target_tags = ["worker"]
}

# Bots, sidecars and the registration call reach the internal site here; independent of the public 443 rule.
resource "google_compute_firewall" "orchestrator_from_worker" {
  name    = "agent-forall-orchestrator-from-worker"
  network = google_compute_network.default.name

  allow {
    protocol = "tcp"
    ports    = ["443"]
  }

  source_tags = ["worker"]
  target_tags = ["orchestrator"]
}

# ── Cloud NAT: workers have no public address. Dynamic ports because 64 per VM drops traffic near 25 bots. ──
resource "google_compute_router" "nat" {
  name    = "agent-forall-nat"
  region  = var.region
  network = google_compute_network.default.id
}

resource "google_compute_address" "nat" {
  count  = 2
  name   = "agent-forall-nat-${count.index + 1}"
  region = var.region
}

resource "google_compute_router_nat" "workers" {
  name                                = "agent-forall-nat"
  router                              = google_compute_router.nat.name
  region                              = var.region
  nat_ip_allocate_option              = "MANUAL_ONLY"
  nat_ips                             = google_compute_address.nat[*].self_link
  source_subnetwork_ip_ranges_to_nat  = "LIST_OF_SUBNETWORKS"
  enable_dynamic_port_allocation      = true
  enable_endpoint_independent_mapping = false
  min_ports_per_vm                    = 512
  max_ports_per_vm                    = 8192

  subnetwork {
    name                    = google_compute_subnetwork.default.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
