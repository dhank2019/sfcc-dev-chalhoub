'use strict';

var fs = require('fs');
var path = require('path');
var RemoveEmptyScriptsPlugin = require('webpack-remove-empty-scripts');
var MiniCssExtractPlugin = require('mini-css-extract-plugin');
var CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
var jsFiles = require('sgmf-scripts').createJsPath();
var scssFiles = require('sgmf-scripts').createScssPath();

/**
 * plugin_fulfillment ships its own client-side assets but is not the root package's
 * "packageName" cartridge, so sgmf-scripts' createJsPath()/createScssPath() (which only ever
 * glob the single cartridge named in package.json) can't see it. These two helpers replicate
 * that same glob/entry-naming logic for the plugin cartridge, so its JS/SCSS compile to their
 * own cartridge/static folder, same as every other SFRA cartridge.
 * @param {string} dir - directory to walk
 * @param {RegExp} extensionPattern - file extension filter
 * @returns {string[]} absolute file paths found under dir
 */
function walk(dir, extensionPattern) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    var results = [];
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
        var fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(walk(fullPath, extensionPattern));
        } else if (extensionPattern.test(entry.name)) {
            results.push(fullPath);
        }
    });
    return results;
}

var pluginClientRoot = path.resolve('./cartridges/plugin_fulfillment/cartridge/client');

var pluginJsFiles = {};
walk(pluginClientRoot, /\.js$/).forEach(function (filePath) {
    var location = path.relative(pluginClientRoot, filePath).replace(/\.js$/, '');
    pluginJsFiles[location] = filePath;
});

var pluginScssFiles = {};
walk(pluginClientRoot, /\.scss$/).forEach(function (filePath) {
    if (path.basename(filePath).indexOf('_') === 0) {
        return;
    }
    var location = path.relative(pluginClientRoot, filePath).replace(/\.scss$/, '').replace(/^default[\\/]scss/, 'default/css');
    pluginScssFiles[location] = filePath;
});

module.exports = [
    {
        mode: 'production',
        name: 'js',
        entry: jsFiles,
        output: {
            path: path.resolve(
                './cartridges/app_storefront_base/cartridge/static'
            ),
            filename: '[name].js'
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules[\\/](?!bootstrap[\\/])/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/env'],
                            plugins: [
                                '@babel/plugin-proposal-object-rest-spread'
                            ],
                            cacheDirectory: true
                        }
                    }
                }
            ]
        }
    },
    {
        mode: 'none',
        name: 'scss',
        entry: scssFiles,
        output: {
            path: path.resolve(
                './cartridges/app_storefront_base/cartridge/static'
            )
        },
        module: {
            rules: [
                {
                    test: /\.scss$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader,
                            options: {
                                esModule: false
                            }
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                url: false
                            }
                        },
                        {
                            loader: 'postcss-loader',
                            options: {
                                postcssOptions: {
                                    plugins: [require('autoprefixer')()]
                                }
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                implementation: require('sass'),
                                sassOptions: {
                                    includePaths: [
                                        path.resolve('node_modules'),
                                        path.resolve(
                                            'node_modules/flag-icon-css/sass'
                                        )
                                    ]
                                }
                            }
                        }
                    ]
                }
            ]
        },
        plugins: [
            new RemoveEmptyScriptsPlugin(),
            new MiniCssExtractPlugin({
                filename: '[name].css',
                chunkFilename: '[name].css'
            })
        ],
        optimization: {
            minimizer: ['...', new CssMinimizerPlugin()]
        }
    },
    {
        mode: 'production',
        name: 'plugin_fulfillment-js',
        entry: pluginJsFiles,
        output: {
            path: path.resolve(
                './cartridges/plugin_fulfillment/cartridge/static'
            ),
            filename: '[name].js'
        },
        module: {
            rules: [
                {
                    test: /\.js$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'babel-loader',
                        options: {
                            presets: ['@babel/env'],
                            plugins: [
                                '@babel/plugin-proposal-object-rest-spread'
                            ],
                            cacheDirectory: true
                        }
                    }
                }
            ]
        }
    },
    {
        mode: 'none',
        name: 'plugin_fulfillment-scss',
        entry: pluginScssFiles,
        output: {
            path: path.resolve(
                './cartridges/plugin_fulfillment/cartridge/static'
            )
        },
        module: {
            rules: [
                {
                    test: /\.scss$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader,
                            options: {
                                esModule: false
                            }
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                url: false
                            }
                        },
                        {
                            loader: 'postcss-loader',
                            options: {
                                postcssOptions: {
                                    plugins: [require('autoprefixer')()]
                                }
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                implementation: require('sass'),
                                sassOptions: {
                                    includePaths: [path.resolve('node_modules')]
                                }
                            }
                        }
                    ]
                }
            ]
        },
        plugins: [
            new RemoveEmptyScriptsPlugin(),
            new MiniCssExtractPlugin({
                filename: '[name].css',
                chunkFilename: '[name].css'
            })
        ],
        optimization: {
            minimizer: ['...', new CssMinimizerPlugin()]
        }
    }
];
