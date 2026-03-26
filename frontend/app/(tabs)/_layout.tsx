import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs tintColor="#EA575F" backgroundColor="#000">
      <NativeTabs.Trigger name="home">
        <Icon sf={{ default: "house", selected: "house.fill" }} />
        <Label>home</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
