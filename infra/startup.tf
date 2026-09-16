# Inputs every VM role shares; the role scripts live in startup/ and render as common.sh + <role>.sh.
locals {
  port_range_start          = 19000
  port_range_end            = 19999
  sidecar_port_range_start  = 18000
  frontend_bridge           = "af-front"
  frontend_subnet           = "172.16.0.0/24"
  orchestrator_frontend_ip  = "172.16.0.10"
  tenant_bridge             = "af-tenant"
  orchestrator_internal_url = "https://orchestrator.internal"
  startup_vars = {
    region               = var.region
    project_id           = var.project_id
    pairing_image        = var.pairing_image
    agent_runtime_image  = var.agent_runtime_image
    hermes_runtime_image = var.hermes_runtime_image
    install_docker       = file("${path.module}/startup/install-docker.sh")
  }
}
