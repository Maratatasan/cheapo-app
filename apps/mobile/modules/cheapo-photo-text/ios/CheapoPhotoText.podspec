Pod::Spec.new do |s|
  s.name = 'CheapoPhotoText'
  s.version = '1.0.0'
  s.summary = 'Local text recognition for Cheapo price photos'
  s.homepage = 'https://github.com/Maratatasan/cheapo-app'
  s.author = 'Cheapo'
  s.platform = :ios, '16.4'
  s.source = { git: s.homepage + '.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = ['Vision', 'ImageIO']
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
