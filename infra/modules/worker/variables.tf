variable "name" {
  description = "Host id of the worker; also the VM name and the prefix of its certificate secrets"
  type        = string
}

variable "ip" {
  type = string
}

variable "machine_type" {
  type = string
}

variable "data_disk_gb" {
  type = number
}

variable "boot_disk_gb" {
  type = number
}

variable "image" {
  description = "Name of the baked worker image in this project"
  type        = string
}

variable "zone" {
  type = string
}

variable "region" {
  type = string
}

variable "subnetwork" {
  description = "Self link of the subnet the worker joins"
  type        = string
}

variable "service_account_email" {
  type = string
}

variable "snapshot_policy" {
  description = "Name of the resource policy that snapshots the data disk"
  type        = string
}

variable "ssh_keys" {
  type = string
}

variable "startup_dir" {
  description = "Directory holding common.sh, worker.sh and guard-worker.rules"
  type        = string
}

variable "startup_vars" {
  description = "Template inputs every role shares"
  type        = map(string)
}

variable "tenant_bridge" {
  type = string
}

variable "orchestrator_internal_url" {
  type = string
}
