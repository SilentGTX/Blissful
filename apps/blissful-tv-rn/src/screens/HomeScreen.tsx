import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { StremioMetaPreview } from '@blissful/core';
import { colors, layout } from '../theme/colors';
import { Rail } from '../components/Rail';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();

  const onSelect = (item: StremioMetaPreview) => {
    navigation.navigate('Detail', {
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.brand}>Blissful</Text>
        <Text style={styles.subtitle}>React Native · Android TV</Text>
        <Rail title="Popular Movies" type="movie" catalogId="top" autoFocusFirst onSelect={onSelect} />
        <Rail title="Popular Series" type="series" catalogId="top" onSelect={onSelect} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingTop: layout.safeY, paddingLeft: layout.safeX, paddingBottom: 60 },
  brand: { color: colors.text, fontSize: 40, fontWeight: '700' },
  subtitle: { color: colors.brand, fontSize: 15, marginTop: 4, marginBottom: 28 },
});
