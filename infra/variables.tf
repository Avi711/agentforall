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

variable "machine_type" {
  description = "VM machine type"
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 50
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
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:1e0b6e70351a04796de186ccb251f4c0fca243ca71518fd5b85e0a83c1453234"
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
