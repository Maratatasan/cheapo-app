require 'fileutils'
require 'ipaddr'
require 'uri'
require 'xcodeproj'

output, team, address = ARGV
abort 'Usage: ruby build-device.rb OUTPUT_DIRECTORY TEAM_ID http://PRIVATE_IP:PORT/' unless address
uri = URI.parse(address)
private_networks = %w[10.0.0.0/8 172.16.0.0/12 192.168.0.0/16].map { |subnet| IPAddr.new(subnet) }
abort 'Use an HTTP URL on the Mac private IPv4 address with no query.' unless
  uri.scheme == 'http' && uri.path == '/' && !uri.query && !uri.fragment && !uri.userinfo &&
  private_networks.any? { |subnet| subnet.include?(uri.host) }
abort 'Expected an Apple development team ID.' unless /\A[A-Z0-9]{10}\z/.match?(team)

FileUtils.mkdir_p(output)
output = File.expand_path(output)
FileUtils.cp(File.join(__dir__, 'MockAuth.swift'), output)
plist = Xcodeproj::Plist.read_from_path(File.join(__dir__, 'Info.plist'))
plist['CFBundleIdentifier'] = '$(PRODUCT_BUNDLE_IDENTIFIER)'
plist['CFBundleDisplayName'] = 'Cheapo Mock Auth'
plist['MockPageURL'] = address
Xcodeproj::Plist.write_to_path(plist, File.join(output, 'Info.plist'))

project = Xcodeproj::Project.new(File.join(output, 'MockAuth.xcodeproj'))
target = project.new_target(:application, 'MockAuth', :ios, '26.0')
target.add_file_references([project.main_group.new_file('MockAuth.swift')])
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!(
    'CODE_SIGN_STYLE' => 'Automatic',
    'DEVELOPMENT_TEAM' => team,
    'INFOPLIST_FILE' => 'Info.plist',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.maratatasan.cheapo.mock-auth',
    'SWIFT_VERSION' => '5.0'
  )
end
project.save
