# Makefile para compilar la memoria y exportar diagramas Mermaid a SVG
# Requisitos:
#   - Node.js instalado
#   - Paquete @mermaid-js/mermaid-cli (instalar con: npm install -g @mermaid-js/mermaid-cli)
#   - Inkscape (para conversión automática del paquete svg si se requiere PDF intermedio)
#   - latexmk y pdflatex
# Uso típico:
#   make diagrams   # Exporta .mmd a .svg
#   make pdf        # Compila Tesis.tex (requiere -shell-escape por svg)
#   make all        # Ejecuta ambos pasos
#   make clean      # Limpia artefactos generados

MERMAID_CLI ?= mmdc
# Escala para PNG (aumenta resolución). Valor por defecto 2; puede ajustarse (ej: 3, 4).
PNG_SCALE ?= 3
# Ancho en pixeles para exportar diagramas (SVG y PNG) para evitar recortes y ampliar eje temporal.
MERMAID_WIDTH ?= 1800
TEX       := Tesis.tex
DIAGRAM_SRC := $(wildcard diagramas/*.mmd)
DIAGRAM_SVG := $(patsubst diagramas/%.mmd,data/%.svg,$(DIAGRAM_SRC))
DIAGRAM_PNG := $(patsubst diagramas/%.mmd,data/%.png,$(DIAGRAM_SRC))

.PHONY: all diagrams pdf clean

all: diagrams pdf

# Exporta cada archivo Mermaid a SVG (vectorial)
diagrams: $(DIAGRAM_PNG)
	@echo "Diagramas Mermaid exportados a SVG y PNG"

# Regla de transformación de .mmd a .svg
# Usa mmdc; si no está instalado, mostrará error claro.
$(DIAGRAM_SVG): data/%.svg: diagramas/%.mmd
	@if ! command -v $(MERMAID_CLI) >/dev/null 2>&1; then \
		echo "ERROR: $(MERMAID_CLI) no encontrado. Instala con: npm install -g @mermaid-js/mermaid-cli"; \
		false; \
	else \
		$(MERMAID_CLI) -i $< -o $@ --backgroundColor transparent -w $(MERMAID_WIDTH); \
		echo "Generado $@"; \
	fi

# Regla de transformación de .mmd a .png
$(DIAGRAM_PNG): data/%.png: diagramas/%.mmd
	@if ! command -v $(MERMAID_CLI) >/dev/null 2>&1; then \
		echo "ERROR: $(MERMAID_CLI) no encontrado. Instala con: npm install -g @mermaid-js/mermaid-cli"; \
		false; \
	else \
		$(MERMAID_CLI) -i $< -o $@ --backgroundColor transparent -s $(PNG_SCALE) -w $(MERMAID_WIDTH) || true; \
		if [ ! -f "$@" ]; then \
			SVG_OUT="$(patsubst data/%.png,data/%.svg,$@)"; \
			$(MERMAID_CLI) -i $< -o $$SVG_OUT --backgroundColor transparent -w $(MERMAID_WIDTH) || true; \
			if [ -f "$$SVG_OUT" ]; then \
				if command -v inkscape >/dev/null 2>&1; then \
					inkscape "$$SVG_OUT" -o "$@" >/dev/null 2>&1 && echo "Convertido $$SVG_OUT → $@ via Inkscape"; \
				else \
					echo "ADVERTENCIA: Inkscape no disponible para fallback de SVG→PNG. Archivo generado: $$SVG_OUT"; \
					false; \
				fi; \
			else \
				echo "ERROR: No se pudo generar $$SVG_OUT ni $@"; \
				false; \
			fi; \
		fi; \
		echo "Generado $@ (escala=$(PNG_SCALE))"; \
	fi

# Compila el documento LaTeX usando svg (requiere shell-escape si el paquete svg procesa archivos)
pdf: $(TEX) $(DIAGRAM_PNG)
	latexmk -xelatex -shell-escape -interaction=nonstopmode $(TEX)

clean:
	latexmk -C
	@rm -f $(DIAGRAM_PNG) $(DIAGRAM_SVG)
	@echo "Limpieza completa"
