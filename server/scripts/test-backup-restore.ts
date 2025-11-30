/**
 * Manual test script for ProgressService backup functionality
 * 
 * Usage: npx ts-node scripts/test-backup-restore.ts
 */

import { db } from '../src/database/client';
import { progressService } from '../src/services/progressService';

async function testBackupRestore() {
  try {
    console.log('🧪 Starting backup/restore test...\n');

    // 1. Find or create a test user
    let user = await db.client.user.findFirst({
      where: { username: 'test_backup_user' },
      include: { progress: true },
    });

    if (!user) {
      console.log('Creating test user...');
      user = await db.client.user.create({
        data: {
          username: 'test_backup_user',
          email: 'test_backup@example.com',
          password: 'test_password_hash',
          homeIp: '192.168.100.100',
        },
      });

      // Create initial progress
      await db.client.playerProgress.create({
        data: {
          userId: user.id,
          level: 5,
          experience: 1000,
          credits: 5000,
          hacking: 50,
        },
      });

      // Reload user with progress
      user = (await db.client.user.findUnique({
        where: { id: user.id },
        include: { progress: true },
      }))!;
    }

    if (!user || !user.progress) {
      throw new Error('User or progress not found');
    }

    console.log(`✅ Using test user: ${user.username} (${user.id})\n`);

    // 2. Create a backup
    console.log('📦 Creating backup...');
    const backup = await progressService.createBackup(user.id, 'manual_test');
    console.log(`✅ Backup created: ${backup?.id}\n`);

    // 3. Store original progress
    const originalProgress = { ...user.progress };
    console.log('💾 Original progress:', {
      level: originalProgress.level,
      experience: originalProgress.experience,
      credits: originalProgress.credits,
    });

    // 4. Modify progress
    console.log('\n🔧 Modifying progress...');
    await db.client.playerProgress.update({
      where: { userId: user.id },
      data: {
        level: 10,
        experience: 5000,
        credits: 10000,
      },
    });

    const modifiedProgress = await db.client.playerProgress.findUnique({
      where: { userId: user.id },
    });
    console.log('✅ Modified progress:', {
      level: modifiedProgress!.level,
      experience: modifiedProgress!.experience,
      credits: modifiedProgress!.credits,
    });

    // 5. Restore from backup
    console.log('\n🔄 Restoring from backup...');
    const restored = await progressService.restoreBackup(user.id, backup!.id);
    
    if (!restored) {
      throw new Error('Restore failed');
    }

    const restoredProgress = await db.client.playerProgress.findUnique({
      where: { userId: user.id },
    });
    console.log('✅ Restored progress:', {
      level: restoredProgress!.level,
      experience: restoredProgress!.experience,
      credits: restoredProgress!.credits,
    });

    // 6. Verify restoration
    const isMatch =
      restoredProgress!.level === originalProgress.level &&
      restoredProgress!.experience === originalProgress.experience &&
      restoredProgress!.credits === originalProgress.credits;

    if (isMatch) {
      console.log('\n✅ TEST PASSED: Progress successfully restored!');
    } else {
      console.log('\n❌ TEST FAILED: Progress mismatch after restore');
    }

    // 7. Test getBackups
    console.log('\n📋 Fetching backups...');
    const backups = await progressService.getBackups(user.id);
    console.log(`✅ Found ${backups.length} backups for user`);

    // 8. Cleanup
    console.log('\n🧹 Cleaning up test...');
    await db.client.user.delete({
      where: { id: user.id },
    });
    console.log('✅ Test cleanup complete\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await db.client.$disconnect();
  }
}

testBackupRestore();
