NAME=icon-matcher

.PHONY: all pack install clean

all: $(NAME).zip

node_modules/.package-lock.json: package.json
	npm install

dist/extension.js dist/prefs.js: node_modules/.package-lock.json src/*.ts
	npm run build

# schemas/gschemas.compiled: schemas/org.gnome.shell.extensions.$(NAME).gschema.xml
# 	glib-compile-schemas schemas

$(NAME).zip: dist/extension.js dist/prefs.js
	# @cp -r schemas dist/
	@cp metadata.json dist/
	@(cd dist && zip ../$(NAME).zip -9r .)

pack: $(NAME).zip

install: $(NAME).zip
	gnome-extensions install --force $(NAME).zip

clean:
	@rm -rf dist node_modules $(NAME).zip
