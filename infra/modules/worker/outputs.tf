output "instance_id" {
  value = google_compute_instance.worker.instance_id
}

output "address" {
  value = google_compute_address.internal.address
}
