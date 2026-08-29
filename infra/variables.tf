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
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:8ef17dddf277a6ee6085aff78d90ee45f01c37d0bda776a36370217b954be92a"
}

variable "pairing_image" {
  description = "WhatsApp pairing sidecar image ref. Prefer immutable GAR digests for production."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/whatsapp-pairing@sha256:20b44400bee9b7ea9c5e233d9dfc779434922b92fd9b9a9dc444ae8054544a57"
}

variable "agent_runtime_image" {
  description = "Legacy OpenClaw runtime image ref. Kept for existing OpenClaw instances only."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/openclaw-browser@sha256:a81764a47c59c7a1130d6ae40dd7eca9f3c644b1bd007eac2d3186a450e44326"
}

variable "hermes_runtime_image" {
  description = "Pinned Hermes runtime image ref. Update only after smoke-testing the exact digest."
  type        = string
  default     = "nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33"
}

variable "litellm_image" {
  description = "LiteLLM gateway image. Set to a GAR image digest for production deploys."
  type        = string
  default     = "europe-west4-docker.pkg.dev/agent-for-all/agent-forall/litellm-gateway@sha256:01f96fab322b52696854d74b96891481744902fd08066e94c00d406538426d05"
}

variable "monitoring_notification_channel_ids" {
  description = "Cloud Monitoring notification channel IDs for production alerts. Empty keeps incidents visible in Monitoring without paging."
  type        = list(string)
  default     = []
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
