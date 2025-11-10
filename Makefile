.PHONY: dev clean clean-all install build

# Development
dev:
	npm run dev

# Install dependencies
# Using --legacy-peer-deps to handle conflict between chromadb@1.8.1 (requires @google/generative-ai@^0.1.1)
# and @langchain/google-genai (requires @google/generative-ai@^0.24.0)
install:
	npm install --legacy-peer-deps

# Build for production
build:
	npm run build

# Clean build artifacts and cache
clean:
	@echo "Cleaning build artifacts and cache..."
	rm -rf .next
	rm -rf dist
	rm -rf node_modules/.cache
	@echo "Clean complete!"

# Clean everything including node_modules
clean-all: clean
	@echo "Cleaning node_modules..."
	rm -rf node_modules
	@echo "Clean all complete! Run 'make install' to reinstall dependencies."
