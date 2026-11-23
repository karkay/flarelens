#!/usr/bin/env ruby
require 'webrick'

port = (ENV['PORT'] || 8080).to_i
root = File.expand_path('../web', __dir__)

server = WEBrick::HTTPServer.new(
  BindAddress: '0.0.0.0',
  Port: port,
  DocumentRoot: root,
  AccessLog: [[$stderr, WEBrick::AccessLog::COMMON_LOG_FORMAT]],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO)
)

server.mount_proc '/health' do |_req, res|
  res.status = 200
  res['Content-Type'] = 'application/json'
  res.body = '{"status":"ok","app":"FlareLens"}'
end

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts "FlareLens local web server running on http://0.0.0.0:#{port}"
$stdout.flush
server.start
