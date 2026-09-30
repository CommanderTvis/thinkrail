Pod::Spec.new do |s|
  s.name = 'ThinkRailOniguruma'
  s.version = '6.9.10'
  s.summary = 'Oniguruma regex scanner for ThinkRail native syntax highlighting'
  s.homepage = 'https://github.com/kkos/oniguruma'
  s.license = { :type => 'BSD-2-Clause', :file => 'COPYING' }
  s.author = 'Oniguruma contributors'
  s.source = { :http => 'https://github.com/kkos/oniguruma/releases/download/v6.9.10/onig-6.9.10.tar.gz',
               :sha256 => '2a5cfc5ae259e4e97f86b68dfffc152cdaffe94e2060b770cb827238d769fc05' }
  s.osx.deployment_target = '14.0'
  s.prepare_command = './configure --disable-shared'
  sources = %w[regparse regcomp regexec regenc regerror regext regsyntax regtrav regversion st reggnu
               unicode unicode_unfold_key unicode_fold1_key unicode_fold2_key unicode_fold3_key
               ascii utf8 utf16_be utf16_le utf32_be utf32_le euc_jp euc_jp_prop sjis sjis_prop
               iso8859_1 iso8859_2 iso8859_3 iso8859_4 iso8859_5 iso8859_6 iso8859_7 iso8859_8
               iso8859_9 iso8859_10 iso8859_11 iso8859_13 iso8859_14 iso8859_15 iso8859_16
               euc_tw euc_kr big5 gb18030 koi8_r cp1251 onig_init]
  s.source_files = ['src/*.h'] + sources.map { |name| "src/#{name}.c" }
  s.public_header_files = 'src/oniguruma.h'
  s.preserve_paths = 'config.h', 'src/unicode*_data*.c'
  s.pod_target_xcconfig = { 'HEADER_SEARCH_PATHS' => '$(PODS_TARGET_SRCROOT)', 'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) HAVE_CONFIG_H' }
end
