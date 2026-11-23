#!/usr/bin/env ruby
# Interactive CLI to generate web/auth-config.js with a salted PBKDF2-SHA256
# password hash and optional AES-256-GCM encrypted Gemini API key.
# Zero plaintext secrets are written to disk.

require 'openssl'
require 'base64'
require 'json'
require 'io/console'

ITERATIONS = 200_000

puts '=== FlareLens GitHub Pages Auth & Encrypted Key Generator ==='
puts 'This writes ONLY a salted PBKDF2-SHA256 hash and AES-256-GCM ciphertext'
puts 'to web/auth-config.js (safe to commit to GitHub Pages).'
puts

print 'Enter login password (min 8 chars, hidden): '
password = $stdin.noecho(&:gets).to_s.chomp
puts
if password.length < 8
  abort 'Error: Password must be at least 8 characters.'
end

print 'Confirm login password (hidden): '
confirm = $stdin.noecho(&:gets).to_s.chomp
puts
abort 'Error: Passwords do not match.' unless password == confirm

print 'Optional Gemini API key to encrypt with this password (leave blank to skip, hidden): '
api_key = $stdin.noecho(&:gets).to_s.chomp
puts

salt = OpenSSL::Random.random_bytes(16)
dk = OpenSSL::KDF.pbkdf2_hmac(
  password,
  salt: salt,
  iterations: ITERATIONS,
  length: 64,
  hash: 'sha256'
)

aes_key = dk[0, 32]
verifier = dk[32, 32]

encrypted_key = nil
unless api_key.empty?
  iv = OpenSSL::Random.random_bytes(12)
  cipher = OpenSSL::Cipher.new('aes-256-gcm')
  cipher.encrypt
  cipher.key = aes_key
  cipher.iv = iv
  ciphertext = cipher.update(api_key) + cipher.final
  tag = cipher.auth_tag(16)
  encrypted_key = {
    alg: 'AES-256-GCM',
    ivB64: Base64.strict_encode64(iv),
    ciphertextB64: Base64.strict_encode64(ciphertext + tag)
  }
end

config = {
  configured: true,
  iterations: ITERATIONS,
  saltB64: Base64.strict_encode64(salt),
  passwordHashB64: Base64.strict_encode64(verifier),
  encryptedGeminiKey: encrypted_key
}

out_path = File.expand_path('../web/auth-config.js', __dir__)
js = <<~JS
  // FlareLens Authentication & Encrypted API Key Vault Configuration
  // Generated safely: contains ONLY salted PBKDF2-SHA256 hash + AES-256-GCM ciphertext.
  // Safe to commit to GitHub Pages (never contains plaintext password or plaintext API key).
  window.FLARELENS_AUTH_CONFIG = #{JSON.pretty_generate(config)};
JS

File.write(out_path, js)
puts
puts "Wrote hashed password & encrypted vault to: #{out_path}"
puts 'You can now commit and push to GitHub Pages safely!'
