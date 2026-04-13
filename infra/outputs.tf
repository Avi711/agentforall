output "external_ip" {
  description = "Static external IP of the platform VM"
  value       = google_compute_address.platform.address
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
