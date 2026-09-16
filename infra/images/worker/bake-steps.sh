
# Appended to install-docker.sh by bake.sh; runs once on the throwaway VM.
metadata() { curl -sf -H "Metadata-Flavor: Google" "http://169.254.169.254/computeMetadata/v1/instance/attributes/$1"; }

curl -fsS -o /tmp/add-google-cloud-ops-agent-repo.sh https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
bash /tmp/add-google-cloud-ops-agent-repo.sh --also-install
rm -f /tmp/add-google-cloud-ops-agent-repo.sh

gcloud auth configure-docker "$(metadata gar-host)" --quiet
metadata pinned-images | while read -r image; do
  [ -z "$image" ] && continue
  docker pull -q "$image"
done

apt-get clean
# The credential helper caches short-lived tokens; they must not ship in the image.
rm -rf /root/.config/gcloud/access_tokens.db /root/.config/gcloud/logs
# GCE's guest environment re-creates instance identity at boot; an empty machine-id makes systemd mint a new one.
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id
# The serial log dies with the VM; a guest attribute outlives the stop.
curl -sf -X PUT -H "Metadata-Flavor: Google" --data complete http://169.254.169.254/computeMetadata/v1/instance/guest-attributes/bake/status
sync
shutdown -h now
