Stop building Velocious during bare `npm install` and `npm ci` commands. Package builds now run once through `prepack`, preserving build output for package publication and Git dependency installs.
