output "external_ip" {
  description = "Static external IP of the platform VM"
  value       = google_compute_address.platform.address
}

output "litellm_gateway_url" {
  description = "Internal Cloud Run URL for the LiteLLM gateway"
  value       = google_cloud_run_v2_service.litellm.uri
}

output "instance_name" {
  description = "Name of the GCP Compute Engine instance"
  value       = google_compute_instance.platform.name
}

output "ssh_command" {
  description = "SSH into the VM"
  value       = "gcloud compute ssh ${var.ssh_user}@${google_compute_instance.platform.name} --zone=${var.zone} --project=${var.project_id}"
}

output "platform_url" {
  description = "URL of the deployed platform"
  value       = var.domain != "" ? "https://${var.domain}" : "http://${google_compute_address.platform.address}"
}

output "image_registry" {
  description = "Docker registry path for pushing platform images"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "github_actions_wif_provider" {
  description = "Workload Identity Provider — set this as GHA secret WIF_PROVIDER"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "github_actions_service_account" {
  description = "CI service account email — set as GHA secret GCP_SA_EMAIL"
  value       = google_service_account.ci_pusher.email
}
