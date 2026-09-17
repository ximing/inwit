import { Alert } from 'react-native';

export function confirmAction(
  title: string,
  message: string,
  ok = '确定',
  destructive = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: '取消', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}
