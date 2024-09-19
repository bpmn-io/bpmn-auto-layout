/* eslint-env node */

const path = require('path');

const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: {
    app: path.resolve(__dirname, './example/src/app.js'),
  },
  output: {
    path: path.resolve(__dirname, './example/dist'),
    filename: '[name].bundle.js',
  },
  module: {
    rules: [
      {
        test: /\.bpmn$/i,
        use: 'raw-loader',
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: [ 'babel-loader' ],
      },
      {
        test: /\.css$/i,
        use: [ 'style-loader', 'css-loader' ],
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './example/src/index.html',
    })
  ],
  devtool: 'eval-source-map',
  devServer: {
    hot: false,
    liveReload: false
  }
};