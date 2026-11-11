#!/usr/bin/env python3
"""ios/Pochitalk.xcodeproj を作り直す (ios/ で `python3 tools/generate_xcodeproj.py`)。
Pochitalk/ と PochitalkTests/ の下のファイルを自動で拾う。ファイルを足したら、もう一度実行する。"""
import hashlib, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_ID = "app.pochitalk.ios"
TEAM = None

# Xcode で入力した「開発チーム」と「アプリのバンドルID」は、作り直しても残す (すでにある project.pbxproj から読み取る)
import re
_old = os.path.join(ROOT, "Pochitalk.xcodeproj", "project.pbxproj")
if os.path.exists(_old):
    _t = open(_old).read()
    _m = re.search(r"DEVELOPMENT_TEAM = ([A-Z0-9]+);", _t)
    if _m: TEAM = _m.group(1)
    _ids = [x for x in re.findall(r"PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);", _t) if not x.endswith(".tests")]
    if _ids: APP_BUNDLE_ID = _ids[0]
try: APP_BUNDLE_ID
except NameError: APP_BUNDLE_ID = BUNDLE_ID
VERSION = "0.1.0"
BUILD = "1"
DEPLOY = "16.0"

def uid(s):
    return hashlib.md5(s.encode()).hexdigest()[:24].upper()

PKGS = [
    ("WebRTC", "https://github.com/stasel/WebRTC", "157.0.0", "WebRTC"),
    ("secp256k1", "https://github.com/21-DOT-DEV/swift-secp256k1", "0.24.0", "P256K"),
]

def collect(folder):
    out = []
    base = os.path.join(ROOT, folder)
    for d, _, files in os.walk(base):
        for f in sorted(files):
            if f.startswith("."): continue
            rel = os.path.relpath(os.path.join(d, f), ROOT)
            out.append(rel)
    return sorted(out)

app_files = collect("Pochitalk")
test_files = collect("PochitalkTests")
mac_files = collect("PochitalkMac")   # Mac 専用 (Info.plist / entitlements / アイコン)
SRC_EXT = (".swift",)

objs = []
def add(i, body): objs.append((i, body))

refs = {}      # path -> fileref id
for p in app_files + test_files + mac_files:
    refs[p] = uid("ref:" + p)

def ftype(p):
    if p.endswith(".swift"): return "sourcecode.swift"
    if p.endswith(".plist"): return "text.plist.xml"
    if p.endswith(".xcassets"): return "folder.assetcatalog"
    if p.endswith(".entitlements"): return "text.plist.entitlements"
    return "file"

# 資産カタログは「フォルダ」として1つの参照にまとめる
def top(p):
    parts = p.split(os.sep)
    for i, s in enumerate(parts):
        if s.endswith(".xcassets"):
            return os.sep.join(parts[:i+1])
    return p

def group_files(files):
    tops = []
    for p in files:
        t = top(p)
        if t not in tops: tops.append(t)
    return tops

app_tops = group_files(app_files)
test_tops = group_files(test_files)
mac_tops = group_files(mac_files)
for t in app_tops + test_tops + mac_tops:
    refs[t] = uid("ref:" + t)

# ---- ファイル参照とビルドファイル
build_src, build_res, test_src = [], [], []
for t in app_tops + test_tops + mac_tops:
    add(refs[t], '{isa = PBXFileReference; lastKnownFileType = %s; name = "%s"; path = "%s"; sourceTree = SOURCE_ROOT; }' % (ftype(t), os.path.basename(t), t))
for t in app_tops:
    if t.endswith(".swift"):
        b = uid("build:" + t); build_src.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])
    elif t.endswith(".xcassets"):
        b = uid("build:" + t); build_res.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])
for t in test_tops:
    if t.endswith(".swift"):
        b = uid("build:" + t); test_src.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])

# Mac: iOS と同じソースを共有し、Mac 専用のアセットは PochitalkMac/ から
IOS_ONLY_ASSETS = (os.path.join("Pochitalk", "Assets.xcassets"),)
mac_src, mac_res = [], []
for t in app_tops:
    if t.endswith(".swift"):
        b = uid("mbuild:" + t); mac_src.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])
for t in mac_tops:
    if t.endswith(".xcassets"):
        b = uid("mbuild:" + t); mac_res.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])
    elif t.endswith(".swift"):
        b = uid("mbuild:" + t); mac_src.append(b); add(b, '{isa = PBXBuildFile; fileRef = %s; }' % refs[t])
mac_ref = uid("product:mac")
add(mac_ref, '{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Pochitalk.app; sourceTree = BUILT_PRODUCTS_DIR; }')
app_ref = uid("product:app"); test_ref = uid("product:test")
add(app_ref, '{isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = Pochitalk.app; sourceTree = BUILT_PRODUCTS_DIR; }')
add(test_ref, '{isa = PBXFileReference; explicitFileType = wrapper.cfbundle; includeInIndex = 0; path = PochitalkTests.xctest; sourceTree = BUILT_PRODUCTS_DIR; }')

# ---- パッケージ
pkg_ref_ids, prod_dep, prod_build = {}, {}, {}
for name, url, ver, prod in PKGS:
    rid = uid("pkg:" + name); pkg_ref_ids[name] = rid
    add(rid, '{isa = XCRemoteSwiftPackageReference; repositoryURL = "%s"; requirement = {kind = exactVersion; version = %s; }; }' % (url, ver))
    for tgt in ("app", "test", "mac"):
        did = uid("dep:%s:%s" % (tgt, name)); prod_dep[(tgt, name)] = did
        add(did, '{isa = XCSwiftPackageProductDependency; package = %s; productName = %s; }' % (rid, prod))
        bid = uid("depbuild:%s:%s" % (tgt, name)); prod_build[(tgt, name)] = bid
        add(bid, '{isa = PBXBuildFile; productRef = %s; }' % did)

# ---- フェーズ
def phase(isa, key, files):
    i = uid(key)
    add(i, '{isa = %s; buildActionMask = 2147483647; files = (%s); runOnlyForDeploymentPostprocessing = 0; }' % (isa, ", ".join(files)))
    return i
app_src_ph = phase("PBXSourcesBuildPhase", "ph:app:src", build_src)
app_res_ph = phase("PBXResourcesBuildPhase", "ph:app:res", build_res)
app_fw_ph = phase("PBXFrameworksBuildPhase", "ph:app:fw", [prod_build[("app", n)] for n, *_ in PKGS])
mac_src_ph = phase("PBXSourcesBuildPhase", "ph:mac:src", mac_src)
mac_res_ph = phase("PBXResourcesBuildPhase", "ph:mac:res", mac_res)
mac_fw_ph = phase("PBXFrameworksBuildPhase", "ph:mac:fw", [prod_build[("mac", n)] for n, *_ in PKGS])
test_src_ph = phase("PBXSourcesBuildPhase", "ph:test:src", test_src)
test_fw_ph = phase("PBXFrameworksBuildPhase", "ph:test:fw", [prod_build[("test", "secp256k1")]])
test_res_ph = phase("PBXResourcesBuildPhase", "ph:test:res", [])

# ---- グループ
main_group = uid("group:main"); prod_group = uid("group:products")
app_group = uid("group:app"); test_group = uid("group:test")
add(app_group, '{isa = PBXGroup; children = (%s); name = Pochitalk; sourceTree = SOURCE_ROOT; }' % ", ".join(refs[t] for t in app_tops))
add(test_group, '{isa = PBXGroup; children = (%s); name = PochitalkTests; sourceTree = SOURCE_ROOT; }' % ", ".join(refs[t] for t in test_tops))
mac_group = uid("group:mac")
add(mac_group, '{isa = PBXGroup; children = (%s); name = PochitalkMac; sourceTree = SOURCE_ROOT; }' % ", ".join(refs[t] for t in mac_tops))
add(prod_group, '{isa = PBXGroup; children = (%s, %s, %s); name = Products; sourceTree = "<group>"; }' % (app_ref, test_ref, mac_ref))
add(main_group, '{isa = PBXGroup; children = (%s, %s, %s, %s); sourceTree = "<group>"; }' % (app_group, test_group, mac_group, prod_group))

# ---- 設定
def cfg(key, name, settings):
    i = uid(key)
    body = "; ".join("%s = %s" % (k, v) for k, v in settings.items())
    add(i, '{isa = XCBuildConfiguration; buildSettings = {%s; }; name = %s; }' % (body, name))
    return i
def cfglist(key, ids):
    i = uid(key)
    add(i, '{isa = XCConfigurationList; buildConfigurations = (%s); defaultConfigurationName = Release; }' % ", ".join(ids))
    return i

common = {
    "ALWAYS_SEARCH_USER_PATHS": "NO", "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES",
    "ENABLE_STRICT_OBJC_MSGSEND": "YES", "GCC_NO_COMMON_BLOCKS": "YES",
    "IPHONEOS_DEPLOYMENT_TARGET": DEPLOY, "SDKROOT": "iphoneos", "SWIFT_VERSION": "5.0",
    "ENABLE_USER_SCRIPT_SANDBOXING": "YES", "MTL_FAST_MATH": "YES",
}
proj_dbg = cfg("proj:debug", "Debug", dict(common, **{"DEBUG_INFORMATION_FORMAT": "dwarf", "ENABLE_TESTABILITY": "YES", "GCC_OPTIMIZATION_LEVEL": "0",
    "ONLY_ACTIVE_ARCH": "YES", "SWIFT_ACTIVE_COMPILATION_CONDITIONS": "DEBUG", "SWIFT_OPTIMIZATION_LEVEL": '"-Onone"'}))
proj_rel = cfg("proj:release", "Release", dict(common, **{"DEBUG_INFORMATION_FORMAT": '"dwarf-with-dsym"', "SWIFT_COMPILATION_MODE": "wholemodule",
    "SWIFT_OPTIMIZATION_LEVEL": '"-O"', "VALIDATE_PRODUCT": "YES"}))
proj_list = cfglist("proj:list", [proj_dbg, proj_rel])

app_settings = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
    "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
    "CODE_SIGN_ENTITLEMENTS": "Pochitalk/Pochitalk.entitlements",
    "CODE_SIGN_STYLE": "Automatic", "CURRENT_PROJECT_VERSION": BUILD, "MARKETING_VERSION": VERSION,
    "INFOPLIST_FILE": "Pochitalk/Info.plist", "GENERATE_INFOPLIST_FILE": "NO",
    "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/Frameworks"',
    "PRODUCT_BUNDLE_IDENTIFIER": APP_BUNDLE_ID, "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "SWIFT_EMIT_LOC_STRINGS": "YES", "TARGETED_DEVICE_FAMILY": '"1,2"', "SUPPORTS_MACCATALYST": "NO",
    "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
}
if TEAM: app_settings["DEVELOPMENT_TEAM"] = TEAM
app_dbg = cfg("app:debug", "Debug", app_settings); app_rel = cfg("app:release", "Release", app_settings)
app_list = cfglist("app:list", [app_dbg, app_rel])
test_settings = {
    "BUNDLE_LOADER": '"$(TEST_HOST)"', "GENERATE_INFOPLIST_FILE": "YES", "CURRENT_PROJECT_VERSION": BUILD,
    "MARKETING_VERSION": VERSION, "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID + ".tests", "PRODUCT_NAME": '"$(TARGET_NAME)"',
    "TEST_HOST": '"$(BUILT_PRODUCTS_DIR)/Pochitalk.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/Pochitalk"',
    "TARGETED_DEVICE_FAMILY": '"1,2"', "CODE_SIGN_STYLE": "Automatic",
}
test_dbg = cfg("test:debug", "Debug", test_settings); test_rel = cfg("test:release", "Release", test_settings)
test_list = cfglist("test:list", [test_dbg, test_rel])

mac_settings = {
    "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
    "CODE_SIGN_ENTITLEMENTS": "PochitalkMac/Pochitalk.entitlements", "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": BUILD, "MARKETING_VERSION": VERSION,
    "INFOPLIST_FILE": "PochitalkMac/Info.plist", "GENERATE_INFOPLIST_FILE": "NO",
    "LD_RUNPATH_SEARCH_PATHS": '"$(inherited) @executable_path/../Frameworks"',
    "PRODUCT_BUNDLE_IDENTIFIER": APP_BUNDLE_ID, "PRODUCT_NAME": "Pochitalk", "SDKROOT": "macosx", "SUPPORTED_PLATFORMS": "macosx",
    "MACOSX_DEPLOYMENT_TARGET": "14.0", "ENABLE_HARDENED_RUNTIME": "YES", "SWIFT_EMIT_LOC_STRINGS": "YES",
    "COMBINE_HIDPI_IMAGES": "YES", "SWIFT_OBJC_BRIDGING_HEADER": "PochitalkMac/Pochitalk-Bridging-Header.h",
}
if TEAM: mac_settings["DEVELOPMENT_TEAM"] = TEAM
mac_dbg = cfg("mac:debug", "Debug", mac_settings); mac_rel = cfg("mac:release", "Release", mac_settings)
mac_list = cfglist("mac:list", [mac_dbg, mac_rel])
mac_t = uid("target:mac")
add(mac_t, '{isa = PBXNativeTarget; buildConfigurationList = %s; buildPhases = (%s, %s, %s); buildRules = (); dependencies = (); name = PochitalkMac; packageProductDependencies = (%s); productName = PochitalkMac; productReference = %s; productType = "com.apple.product-type.application"; }'
    % (mac_list, mac_src_ph, mac_fw_ph, mac_res_ph, ", ".join(prod_dep[("mac", n)] for n, *_ in PKGS), mac_ref))
app_t = uid("target:app"); test_t = uid("target:test")
add(app_t, '{isa = PBXNativeTarget; buildConfigurationList = %s; buildPhases = (%s, %s, %s); buildRules = (); dependencies = (); name = Pochitalk; packageProductDependencies = (%s); productName = Pochitalk; productReference = %s; productType = "com.apple.product-type.application"; }'
    % (app_list, app_src_ph, app_fw_ph, app_res_ph, ", ".join(prod_dep[("app", n)] for n, *_ in PKGS), app_ref))
dep_proxy = uid("proxy:test"); dep_t = uid("dep:test")
add(dep_proxy, '{isa = PBXContainerItemProxy; containerPortal = %s; proxyType = 1; remoteGlobalIDString = %s; remoteInfo = Pochitalk; }' % (uid("project"), app_t))
add(dep_t, '{isa = PBXTargetDependency; target = %s; targetProxy = %s; }' % (app_t, dep_proxy))
add(test_t, '{isa = PBXNativeTarget; buildConfigurationList = %s; buildPhases = (%s, %s, %s); buildRules = (); dependencies = (%s); name = PochitalkTests; packageProductDependencies = (%s); productName = PochitalkTests; productReference = %s; productType = "com.apple.product-type.bundle.unit-test"; }'
    % (test_list, test_src_ph, test_fw_ph, test_res_ph, dep_t, prod_dep[("test", "secp256k1")], test_ref))

add(uid("project"), '{isa = PBXProject; attributes = {BuildIndependentTargetsInParallel = 1; LastSwiftUpdateCheck = 2700; LastUpgradeCheck = 2700; }; buildConfigurationList = %s; compatibilityVersion = "Xcode 14.0"; developmentRegion = ja; hasScannedForEncodings = 0; knownRegions = (ja, en, Base); mainGroup = %s; packageReferences = (%s); productRefGroup = %s; projectDirPath = ""; projectRoot = ""; targets = (%s, %s, %s); }'
    % (proj_list, main_group, ", ".join(pkg_ref_ids.values()), prod_group, app_t, test_t, mac_t))

# ---- 出力
sections = {}
for i, body in objs:
    isa = body.split("isa = ")[1].split(";")[0]
    sections.setdefault(isa, []).append((i, body))
out = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 56;", "\tobjects = {", ""]
for isa in sorted(sections):
    out.append("/* Begin %s section */" % isa)
    for i, body in sorted(sections[isa]):
        out.append("\t\t%s = %s;" % (i, body))
    out.append("/* End %s section */\n" % isa)
out += ["\t};", "\trootObject = %s;" % uid("project"), "}", ""]
d = os.path.join(ROOT, "Pochitalk.xcodeproj")
os.makedirs(d, exist_ok=True)
open(os.path.join(d, "project.pbxproj"), "w").write("\n".join(out))
# 共有スキーム (テスト付き)
sd = os.path.join(d, "xcshareddata", "xcschemes"); os.makedirs(sd, exist_ok=True)
scheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2700" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "YES" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{app_t}" BuildableName = "Pochitalk.app" BlueprintName = "Pochitalk" ReferencedContainer = "container:Pochitalk.xcodeproj"/>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <TestAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv = "YES">
      <Testables>
         <TestableReference skipped = "NO">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{test_t}" BuildableName = "PochitalkTests.xctest" BlueprintName = "PochitalkTests" ReferencedContainer = "container:Pochitalk.xcodeproj"/>
         </TestableReference>
      </Testables>
   </TestAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{app_t}" BuildableName = "Pochitalk.app" BlueprintName = "Pochitalk" ReferencedContainer = "container:Pochitalk.xcodeproj"/>
      </BuildableProductRunnable>
   </LaunchAction>
   <ProfileAction buildConfiguration = "Release" shouldUseLaunchSchemeArgsEnv = "YES" savedToolIdentifier = "" useCustomWorkingDirectory = "NO" debugDocumentVersioning = "YES"/>
   <AnalyzeAction buildConfiguration = "Debug"/>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES"/>
</Scheme>
'''
open(os.path.join(sd, "Pochitalk.xcscheme"), "w").write(scheme)
mscheme = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion = "2700" version = "1.7">
   <BuildAction parallelizeBuildables = "YES" buildImplicitDependencies = "YES">
      <BuildActionEntries>
         <BuildActionEntry buildForTesting = "NO" buildForRunning = "YES" buildForProfiling = "YES" buildForArchiving = "YES" buildForAnalyzing = "YES">
            <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{mac_t}" BuildableName = "Pochitalk.app" BlueprintName = "PochitalkMac" ReferencedContainer = "container:Pochitalk.xcodeproj"/>
         </BuildActionEntry>
      </BuildActionEntries>
   </BuildAction>
   <LaunchAction buildConfiguration = "Debug" selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB" launchStyle = "0" useCustomWorkingDirectory = "NO" ignoresPersistentStateOnLaunch = "NO" debugDocumentVersioning = "YES" debugServiceExtension = "internal" allowLocationSimulation = "YES">
      <BuildableProductRunnable runnableDebuggingMode = "0">
         <BuildableReference BuildableIdentifier = "primary" BlueprintIdentifier = "{mac_t}" BuildableName = "Pochitalk.app" BlueprintName = "PochitalkMac" ReferencedContainer = "container:Pochitalk.xcodeproj"/>
      </BuildableProductRunnable>
   </LaunchAction>
   <ArchiveAction buildConfiguration = "Release" revealArchiveInOrganizer = "YES"/>
</Scheme>
'''
open(os.path.join(sd, "PochitalkMac.xcscheme"), "w").write(mscheme)
print("wrote", d, len(app_files), "app files")
