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
