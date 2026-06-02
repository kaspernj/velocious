const {getDefaultConfig} = require("expo/metro-config")
const path = require("path")

const config = getDefaultConfig(__dirname)
const velociousRoot = path.resolve(__dirname, "../..")
const minifierConfig = config.transformer.minifierConfig || {}
const existingBlockList = config.resolver.blockList

function pathPattern(filePath) {
  return new RegExp(filePath.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&"))
}

config.transformer.minifierConfig = {
  ...minifierConfig,
  keep_classnames: true,
  keep_fnames: true,
  mangle: {
    ...minifierConfig.mangle,
    keep_classnames: true,
    keep_fnames: true
  }
}

config.resolver.blockList = [
  ...(Array.isArray(existingBlockList) ? existingBlockList : existingBlockList ? [existingBlockList] : []),
  pathPattern(path.resolve(velociousRoot, "node_modules", "react")),
  pathPattern(path.resolve(velociousRoot, "node_modules", "react-dom")),
  pathPattern(path.resolve(velociousRoot, "node_modules", "react-native")),
  pathPattern(path.resolve(velociousRoot, "node_modules", "react-native-web")),
  /\.velocious-advisory-locks[/\\]/
]

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(velociousRoot, "node_modules")
]

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  velocious: velociousRoot
}

config.watchFolders = [velociousRoot]

module.exports = config
