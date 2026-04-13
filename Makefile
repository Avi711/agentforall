.PHONY: deploy destroy status logs ssh api-key plan build dev

# ──────────────────────────────────────────────
# Infrastructure (run from CI/CD or your machine)
# ──────────────────────────────────────────────

plan:
	cd infra && terraform init && terraform plan

deploy:
	cd infra && terraform init && terraform apply -auto-approve
	@echo ""
	@echo "Deployment complete. Run 'make ssh' to access the VM."
	@echo "Run 'make api-key' to retrieve the initial API key."

destroy:
	cd infra && terraform destroy -auto-approve

# ──────────────────────────────────────────────
# Operations
# ──────────────────────────────────────────────

ssh:
	$$(cd infra && terraform output -raw ssh_command)

status:
	$$(cd infra && terraform output -raw ssh_command) -- docker compose -f /home/deploy/agent-forall/docker-compose.yml ps

logs:
	$$(cd infra && terraform output -raw ssh_command) -- docker compose -f /home/deploy/agent-forall/docker-compose.yml logs -f --tail=100

api-key:
	$$(cd infra && terraform output -raw ssh_command) -- cat /home/deploy/agent-forall/.first-api-key

# ──────────────────────────────────────────────
# Local development
# ──────────────────────────────────────────────

build:
	npm run build

dev:
	npm run dev
