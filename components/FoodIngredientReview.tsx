import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../constants/theme';
import { DetectedIngredient } from '../types';
import { normalizeIngredientKey } from '../services/geminiFoodService';

export const FoodIngredientReview: React.FC<{
  ingredients: DetectedIngredient[];
  onChange: (next: DetectedIngredient[]) => void;
}> = ({ ingredients, onChange }) => {
  const [newIngredientName, setNewIngredientName] = useState('');

  const toggleIngredient = (id: string) => {
    onChange(
      ingredients.map((ing) =>
        ing.id === id ? { ...ing, included: !ing.included } : ing
      )
    );
  };

  const handleAddManual = () => {
    const trimmed = newIngredientName.trim();
    if (!trimmed) return;
    const added: DetectedIngredient = {
      id: `manual_ing_${Date.now()}`,
      name: trimmed,
      normalizedKey: normalizeIngredientKey(trimmed),
      category: 'User Added',
      commonEczemaTrigger: false,
      included: true,
    };
    onChange([...ingredients, added]);
    setNewIngredientName('');
  };

  return (
    <View>
      <Text style={styles.helperText}>
        Tap an ingredient to include or exclude it. Each selected ingredient is logged as a trackable correlation variable.
      </Text>

      <View style={styles.list}>
        {ingredients.map((ing) => (
          <Pressable
            key={ing.id}
            onPress={() => toggleIngredient(ing.id)}
            style={[
              styles.row,
              ing.included ? styles.rowIncluded : styles.rowExcluded,
            ]}
          >
            <Ionicons
              name={ing.included ? 'checkbox' : 'square-outline'}
              size={20}
              color={ing.included ? COLORS.primary : COLORS.textMuted}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.nameLine}>
                <Text
                  style={[
                    styles.ingName,
                    !ing.included && styles.ingNameExcluded,
                  ]}
                >
                  {ing.name}
                </Text>
                {ing.commonEczemaTrigger && (
                  <View style={styles.triggerPill}>
                    <Text style={styles.triggerPillText}>
                      {ing.triggerGroup || 'Common Trigger'}
                    </Text>
                  </View>
                )}
              </View>
              {ing.notes ? <Text style={styles.notes}>{ing.notes}</Text> : null}
            </View>
          </Pressable>
        ))}
      </View>

      <View style={styles.addRow}>
        <TextInput
          value={newIngredientName}
          onChangeText={setNewIngredientName}
          placeholder="Add missing ingredient (e.g. Oat Milk, Peanuts)"
          placeholderTextColor={COLORS.textMuted}
          style={styles.input}
          onSubmitEditing={handleAddManual}
        />
        <Pressable onPress={handleAddManual} style={styles.addBtn}>
          <Ionicons name="add" size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  helperText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: SPACING.sm + 2,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  rowIncluded: {
    backgroundColor: COLORS.surfaceElevated,
    borderColor: COLORS.border,
  },
  rowExcluded: {
    backgroundColor: COLORS.surfaceMuted,
    borderColor: COLORS.borderLight,
    opacity: 0.6,
  },
  nameLine: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  ingName: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  ingNameExcluded: {
    textDecorationLine: 'line-through',
    color: COLORS.textMuted,
  },
  triggerPill: {
    backgroundColor: COLORS.warningLight,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  triggerPillText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: COLORS.warning,
  },
  notes: {
    fontSize: 11.5,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: SPACING.md,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.surfaceElevated,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13.5,
    color: COLORS.text,
  },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
