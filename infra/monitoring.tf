locals {
  alert_channels = concat(
    var.monitoring_notification_channel_ids,
    google_monitoring_notification_channel.email[*].id,
  )
  vm_filter = "resource.type=\"gce_instance\" AND resource.labels.instance_id=\"${google_compute_instance.platform.instance_id}\""
}

resource "google_monitoring_notification_channel" "email" {
  count        = var.alert_email != "" ? 1 : 0
  display_name = "agent-forall operator"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }
}

resource "google_monitoring_uptime_check_config" "api" {
  display_name = "agent-forall API health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = var.domain
    }
  }
}

resource "google_monitoring_alert_policy" "api_down" {
  display_name          = "agent-forall API unreachable"
  combiner              = "OR"
  enabled               = true
  notification_channels = local.alert_channels

  conditions {
    display_name = "Uptime check failing for 2 minutes"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.api.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"

      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }

      trigger {
        count = 1
      }
    }
  }
}

resource "google_monitoring_alert_policy" "vm_memory" {
  display_name          = "agent-forall VM memory pressure"
  combiner              = "OR"
  enabled               = true
  notification_channels = local.alert_channels

  conditions {
    display_name = "Memory used above 85 percent for 5 minutes"
    condition_threshold {
      filter          = "${local.vm_filter} AND metric.type=\"agent.googleapis.com/memory/percent_used\" AND metric.labels.state=\"used\""
      comparison      = "COMPARISON_GT"
      threshold_value = 85
      duration        = "300s"

      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
}

# Info-level lines (pino level 30, mostly request logs) stay on the VM; warnings and errors are ingested.
resource "google_logging_project_exclusion" "orchestrator_info" {
  name        = "orchestrator-info-noise"
  description = "Drop orchestrator info-level container logs; docker logs on the VM still has them."
  filter      = "logName=\"projects/${var.project_id}/logs/gcplogs-docker-driver\" AND jsonPayload.container.name=\"/orchestrator\" AND jsonPayload.message:\"\\\"level\\\":30,\""
}

# The orchestrator logs these at error level; they mean a bot needs a human.
resource "google_monitoring_alert_policy" "orchestrator_errors" {
  display_name          = "agent-forall orchestrator needs attention"
  combiner              = "OR"
  enabled               = true
  notification_channels = local.alert_channels

  conditions {
    display_name = "Auto restart budget exhausted or fleet-wide liveness failure"
    condition_matched_log {
      filter = "${local.vm_filter} AND logName=\"projects/${var.project_id}/logs/gcplogs-docker-driver\" AND jsonPayload.container.name=\"/orchestrator\" AND (jsonPayload.message:\"auto restart budget exhausted\" OR jsonPayload.message:\"most bots failed liveness at once\")"
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "1800s"
    }
    auto_close = "3600s"
  }
}
