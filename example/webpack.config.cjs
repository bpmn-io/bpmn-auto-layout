/* eslint-env node */

const HtmlWebpackPlugin = require('html-webpack-plugin');
const path = require('path');

module.exports = (env, argv) => {

  const mode = argv.mode || 'development';

  const devtool = mode === 'development' ? 'eval-source-map' : 'source-map';

  return {
    mode,
    context: __dirname,
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, './dist'),
      filename: 'bundle.js'
    },
    module: {
      rules: [
        {
          test: /\.js/,
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.(css)$/,
          use: [ 'style-loader', 'css-loader' ],
        },
        {
          test: /\.bpmn$/,
          type: 'asset/source'
        }
      ]
    },
    devtool,
    devServer: {
      hot: false
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: 'src/index.html'
      })
    ]
  };

};