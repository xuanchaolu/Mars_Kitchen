#import <Foundation/Foundation.h>
#import <Speech/Speech.h>

// macos-speech <wav-path> [locale] [out-json] — 用系统 SFSpeechRecognizer 转写，输出 JSON {"text":...} 或 {"error":...}

static NSString *gOutPath = nil;
static NSString *gStage = @"start";

static void emit(NSDictionary *obj) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
    printf("%s\n", (const char *)data.bytes);
    fflush(stdout);
    if (gOutPath) [data writeToFile:gOutPath atomically:YES];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) {
            emit(@{@"error": @"usage: macos-speech <wav-path> [locale] | --prepare"});
            return 2;
        }
        // --prepare: 只请求语音识别权限（首次会弹系统授权框），授权完成后退出，供点击麦克风时预授权。
        if (strcmp(argv[1], "--prepare") == 0) {
            __block BOOL authDone = NO;
            __block BOOL authorized = NO;
            [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
                authorized = (status == SFSpeechRecognizerAuthorizationStatusAuthorized);
                authDone = YES;
            }];
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:60];
            while (!authDone && [deadline timeIntervalSinceNow] > 0) {
                [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
            }
            if (!authDone) { emit(@{@"error": @"等待语音识别权限超时"}); return 1; }
            if (!authorized) { emit(@{@"error": @"语音识别权限被拒绝，请在系统设置 → 隐私与安全性 → 语音识别中允许本应用"}); return 1; }
            emit(@{@"authorized": @YES});
            return 0;
        }
        NSString *path = [NSString stringWithUTF8String:argv[1]];
        if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
            emit(@{@"error": @"audio file not found"});
            return 2;
        }
        NSString *localeId = argc >= 3 ? [NSString stringWithUTF8String:argv[2]] : @"zh-CN";
        if (argc >= 4) gOutPath = [NSString stringWithUTF8String:argv[3]];
        SFSpeechRecognizer *recognizer = [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale localeWithLocaleIdentifier:localeId]];
        if (!recognizer) {
            emit(@{@"error": @"当前系统不支持该语言的语音识别"});
            return 1;
        }

        __block NSString *text = @"";
        __block NSString *error = nil;
        __block BOOL done = NO;

        [SFSpeechRecognizer requestAuthorization:^(SFSpeechRecognizerAuthorizationStatus status) {
            gStage = [NSString stringWithFormat:@"auth-status-%ld", (long)status];
            if (status != SFSpeechRecognizerAuthorizationStatusAuthorized) {
                error = @"语音识别权限被拒绝，请在系统设置 → 隐私与安全性 → 语音识别中允许本应用";
                done = YES;
                return;
            }
            if (!recognizer.isAvailable) {
                error = @"系统语音识别服务暂不可用";
                done = YES;
                return;
            }
            SFSpeechURLRecognitionRequest *request =
                [[SFSpeechURLRecognitionRequest alloc] initWithURL:[NSURL fileURLWithPath:path]];
            request.shouldReportPartialResults = NO;
            if (@available(macOS 13.0, *)) {
                if (recognizer.supportsOnDeviceRecognition) request.requiresOnDeviceRecognition = YES;
            }
            gStage = [NSString stringWithFormat:@"task-start ondevice=%d", request.requiresOnDeviceRecognition];
            [recognizer recognitionTaskWithRequest:request resultHandler:^(SFSpeechRecognitionResult *result, NSError *err) {
                gStage = @"task-callback";
                if (done) return;
                if (err) {
                    error = err.localizedDescription;
                    done = YES;
                    return;
                }
                if (!result) return;
                text = result.bestTranscription.formattedString;
                if (result.isFinal) {
                    done = YES;
                }
            }];
        }];

        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:55];
        while (!done && [deadline timeIntervalSinceNow] > 0) {
            [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        }
        if (!done) {
            emit(@{@"error": @"系统语音识别超时", @"stage": gStage});
            return 1;
        }
        if (error) {
            emit(@{@"error": error});
            return 1;
        }
        emit(@{@"text": text ?: @""});
        return 0;
    }
}