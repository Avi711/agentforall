resource "google_project_service" "dns" {
  service            = "dns.googleapis.com"
  disable_on_destroy = false
}

# The apex, never a zone named `internal.`: that would shadow GCE's own internal DNS.
resource "google_dns_managed_zone" "orchestrator_internal" {
  name        = "orchestrator-internal"
  dns_name    = "orchestrator.internal."
  description = "Bots and workers reach the orchestrator's internal site by this name"
  visibility  = "private"

  private_visibility_config {
    networks {
      network_url = google_compute_network.default.id
    }
  }

  depends_on = [google_project_service.dns]
}

resource "google_dns_record_set" "orchestrator_internal" {
  managed_zone = google_dns_managed_zone.orchestrator_internal.name
  name         = google_dns_managed_zone.orchestrator_internal.dns_name
  type         = "A"
  ttl          = 60
  rrdatas      = [var.control_plane_vm == "orchestrator" ? google_compute_address.orchestrator_internal.address : google_compute_address.platform_internal.address]
}
