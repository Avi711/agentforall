variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "vpc_cidr" {
  description = "Primary range of the europe-west4 subnet of the default VPC (imported, not created)."
  type        = string
  default     = "10.164.0.0/20"
}

variable "workers" {
  description = "Worker VMs by host id. The ip is reserved in the subnet and baked into that worker's server certificate."
  type = map(object({
    ip           = string
    machine_type = string
    data_disk_gb = number
  }))
  default = {}
}

variable "worker_image" {
  description = "Name of the baked worker image (infra/images/worker/bake.sh), pinned like a container digest."
  type        = string
  default     = ""
}

variable "worker_boot_disk_gb" {
  description = "Worker boot disk: OS plus every image layer (the containerd store stays on the boot disk)."
  type        = number
  default     = 60
}

variable "domain" {
  description = "Domain for TLS (e.g. openclaw.example.com). Leave empty for IP-only."
  type        = string
  default     = ""
}

variable "ssh_user" {
  description = "SSH username for provisioning"
  type        = string
  default     = "deploy"
}

variable "ssh_public_key_path" {
  description = "Path to SSH public key for provisioning"
  type        = string
  default     = "~/.ssh/id_rsa.pub"
}

variable "github_repo" {
  description = "GitHub repo allowed to push images via Workload Identity Federation (e.g. avi711/agentforall)"
  type        = string
  default     = "Avi711/agentforall"
}

variable "orchestrator_image" {
  description = "Immutable orchestrator image ref. Production must use a GAR digest or git-SHA tag, never :latest."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:8998b67b7e4903d6c57f431769dec7a70fb19429bc91aa84003eede8b81d1617"
}

variable "pairing_image" {
  description = "WhatsApp pairing sidecar image ref (GAR tag waversion-1043857760: Baileys WA version pin, remote version fetch disabled)."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/whatsapp-pairing@sha256:d09178dd106501f0968a9d8d589d1aaaff2851c5b7540ece03f403136e05e52f"
}

variable "agent_runtime_image" {
  description = "Pinned OpenClaw runtime image ref (openclaw-browser 2026.8.2). Update only after smoke-testing the exact digest."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/openclaw-browser@sha256:f0e4aec97e55e0a3afd852ef72994cfe4ed3157ff4a90554de0a66b3940c31ca"
}

variable "hermes_runtime_image" {
  description = "Pinned Hermes runtime image ref. Update only after smoke-testing the exact digest."
  type        = string
  default     = "nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33"
}

variable "litellm_image" {
  description = "LiteLLM gateway image. Set to a GAR image digest for production deploys."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/litellm-gateway@sha256:5bab1ca78080eb26f88a5cd89c32bffaa0fbe799a135390cae1c175b50fc10e0"
}

variable "monitoring_notification_channel_ids" {
  description = "Extra Cloud Monitoring notification channel IDs for production alerts, on top of the email channel."
  type        = list(string)
  default     = []
}

variable "alert_email" {
  description = "Operator email for production alerts. Empty disables the email channel (incidents stay visible in Monitoring)."
  type        = string
  default     = ""
}

variable "litellm_min_instances" {
  description = "Minimum Cloud Run LiteLLM instances kept warm."
  type        = number
  default     = 1
}

variable "litellm_max_instances" {
  description = "Maximum Cloud Run LiteLLM instances."
  type        = number
  default     = 5
}

variable "litellm_cpu" {
  description = "Cloud Run CPU limit for each LiteLLM instance."
  type        = string
  default     = "1"
}

variable "litellm_memory" {
  description = "Cloud Run memory limit for each LiteLLM instance."
  type        = string
  default     = "2Gi"
}

variable "litellm_db_tier" {
  description = "Cloud SQL tier for the LiteLLM Postgres database."
  type        = string
  default     = "db-g1-small"
}

variable "litellm_db_disk_size_gb" {
  description = "Initial LiteLLM Cloud SQL disk size in GB."
  type        = number
  default     = 20
}

variable "litellm_db_deletion_protection" {
  description = "Deletion protection for the LiteLLM Cloud SQL instance."
  type        = bool
  default     = true
}

variable "move_source_retention_ms" {
  description = "How long a moved bot's old volume stays on the previous host as the rollback; lowered only while a host is being drained"
  type        = number
  default     = 86400000
}

variable "orchestrator_vm_internal_ip" {
  description = "Reserved VPC address of the control-plane VM"
  type        = string
  default     = "10.164.0.5"
}

variable "orchestrator_vm_machine_type" {
  description = "The control plane uses ~150 MB; resizing is a two-minute stop"
  type        = string
  default     = "e2-small"
}

variable "caddy_image" {
  description = "Caddy image, pinned by digest"
  type        = string
  default     = "caddy:2.8-alpine@sha256:af32e97399febea808609119bb21544d0265c58a02836576e32a2d082c262c17"
}

variable "docker_proxy_image" {
  description = "Docker socket proxy image, pinned by digest"
  type        = string
  default     = "tecnativa/docker-socket-proxy:0.3@sha256:9e4b9e7517a6b660f2cc903a19b257b1852d5b3344794e3ea334ff00ae677ac2"
}
