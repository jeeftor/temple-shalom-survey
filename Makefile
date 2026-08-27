-include .env
export

CF_PROJECT = temple-shalom-survey

.PHONY: deploy open

## deploy: Push to Cloudflare Pages
deploy:
	CLOUDFLARE_API_TOKEN=$(CF_API_TOKEN) npx wrangler pages deploy . \
		--project-name $(CF_PROJECT) \
		--commit-dirty=true

## open: Open the live survey in your browser
open:
	open https://$(CF_PROJECT).pages.dev
